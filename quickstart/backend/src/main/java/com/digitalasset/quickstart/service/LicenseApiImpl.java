// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

package com.digitalasset.quickstart.service;

import static com.digitalasset.quickstart.service.ServiceUtils.ensurePresent;
import static com.digitalasset.quickstart.service.ServiceUtils.traceServiceCallAsync;
import static com.digitalasset.quickstart.utility.TracingUtils.tracingCtx;
import static com.digitalasset.quickstart.utility.Utils.*;

import com.daml.ledger.api.v2.CommandsOuterClass;
import com.digitalasset.quickstart.api.LicensesApi;
import com.digitalasset.quickstart.ledger.LedgerApi;
import com.digitalasset.quickstart.ledger.TokenStandardProxy;
import com.digitalasset.quickstart.pqs.Contract;
import com.digitalasset.quickstart.repository.DamlRepository;
import com.digitalasset.quickstart.security.AuthUtils;
import com.digitalasset.transcode.java.ContractId;
import com.digitalasset.transcode.java.Party;
import daml_stdlib_da_time_types.da.time.types.RelTime;
import io.opentelemetry.instrumentation.annotations.WithSpan;

import java.time.Duration;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.*;
import java.util.concurrent.CompletableFuture;

import org.openapitools.model.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.server.ResponseStatusException;
import quickstart_licensing.licensing.license.License.License_Expire;
import quickstart_licensing.licensing.license.License.License_Renew;
import quickstart_licensing.licensing.license.LicenseRenewalRequest.LicenseRenewalRequest_CompleteRenewal;
import splice_api_token_holding_v2.splice.api.token.holdingv2.InstrumentId;
import splice_api_token_metadata_v1.splice.api.token.metadatav1.ChoiceContext;
import splice_api_token_metadata_v1.splice.api.token.metadatav1.ExtraArgs;

import splice_api_token_allocation_instruction_v2.splice.api.token.allocationinstructionv2.AllocationFactory.AllocationFactory_Allocate;
import splice_api_token_allocation_v2.splice.api.token.allocationv2.Allocation;
import splice_api_token_allocation_v2.splice.api.token.allocationv2.AllocationSpecification;
import splice_api_token_allocation_v2.splice.api.token.allocationv2.FinalizedAllocation;
import splice_api_token_allocation_v2.splice.api.token.allocationv2.SettlementFactory.SettlementFactory_SettleBatch;
import splice_api_token_allocation_v2.splice.api.token.allocationv2.TransferLeg;
import splice_api_token_allocation_v2.splice.api.token.allocationv2.TransferLegSide;
import splice_api_token_allocation_v2.splice.api.token.allocationv2.TransferSide;

/**
 * Management service for handling contract-based operations on Licenses.
 */
@Controller
@RequestMapping("${openapi.asset.base-path:}")
public class LicenseApiImpl implements LicensesApi {

    private static final Logger logger = LoggerFactory.getLogger(LicenseApiImpl.class);

    private final LedgerApi ledger;
    private final DamlRepository damlRepository;
    private final TokenStandardProxy tokenStandardProxy;
    private final AuthUtils auth;

    public LicenseApiImpl(
            LedgerApi ledger,
            DamlRepository damlRepository,
            TokenStandardProxy tokenStandardProxy,
            AuthUtils authUtils
    ) {
        this.ledger = ledger;
        this.damlRepository = damlRepository;
        this.tokenStandardProxy = tokenStandardProxy;
        this.auth = authUtils;
    }

    /**
     * Lists active License contracts visible to the authenticated party.
     */
    @Override
    @WithSpan
    public CompletableFuture<ResponseEntity<List<License>>> listLicenses() {
        var ctx = tracingCtx(logger, "listLicenses");
        return auth.asAuthenticatedParty(party -> traceServiceCallAsync(ctx, () ->
                damlRepository.findActiveLicenses(party).thenApply(res -> res.stream()
                        .map(LicenseApiImpl::toLicenseApi)
                        .sorted(Comparator.comparing(License::getUser).thenComparingInt(License::getLicenseNum))
                        .toList()
                ).thenApply(ResponseEntity::ok)
        ));
    }

    @Override
    @WithSpan
    public CompletableFuture<ResponseEntity<Void>> renewLicense(
            String contractId,
            String commandId,
            LicenseRenewRequest request
    ) {
        var ctx = tracingCtx(logger, "renewLicense",
                "contractId", contractId,
                "commandId", commandId
        );
        return auth.asAdminParty(party -> traceServiceCallAsync(ctx, () -> {
            var fee = request.getLicenseFeeCc();
            if (fee == null || fee.signum() <= 0) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "licenseFeeCc must be greater than zero");
            }
            var extension = parseRenewalExtension(request.getLicenseExtensionDuration());
            var registryAdminIdFut = tokenStandardProxy.getRegistryAdminId();
            var licenseFut = damlRepository.findLicenseById(contractId);
            return registryAdminIdFut.thenCombine(licenseFut, (adminId, optLicense) -> {
                var license = ensurePresent(optLicense, "License not found for contract %s", contractId);
                var now = Instant.now();
                License_Renew choice = new License_Renew(
                        UUID.randomUUID().toString(),
                        new InstrumentId(new Party(adminId), "Amulet"),
                        fee,
                        extension,
                        now,
                        now.plus(Duration.parse(request.getSettleBeforeDuration())),
                        request.getDescription()
                );
                return ledger.exerciseAndGetResult(license.contractId, choice, commandId)
                        .<ResponseEntity<Void>>thenApply(r -> ResponseEntity.status(HttpStatus.CREATED).build());
                }).thenCompose(x -> x);
        }));
    }

    private static RelTime parseRenewalExtension(String duration) {
        if (duration == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "licenseExtensionDuration is required");
        }
        try {
            var extension = parseRelTime(duration);
            if (extension.getMicroseconds <= 0) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "licenseExtensionDuration must be at least one microsecond");
            }
            return extension;
        } catch (DateTimeParseException | ArithmeticException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid licenseExtensionDuration", e);
        }
    }

    @Override
    @WithSpan
    public CompletableFuture<ResponseEntity<LicenseRenewalResult>> completeLicenseRenewal(
            String contractId,
            String commandId,
            CompleteLicenseRenewalRequest request
    ) {
        var ctx = tracingCtx(logger, "completeLicenseRenewal",
                "contractId", contractId,
                "commandId", commandId
        );
        return auth.asAdminParty(party -> traceServiceCallAsync(ctx, () ->
                damlRepository.findActiveLicenseRenewalRequestById(request.getRenewalRequestContractId())
                        .thenCompose(found -> {
                            var renewal = ensurePresent(found, "Active renewal request not found for contract %s",
                                    request.getRenewalRequestContractId());
                            if (!party.equals(renewal.payload.getProvider.getParty)) {
                                throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Only the provider can complete renewal");
                            }
                            if (!Instant.now().isBefore(renewal.payload.getSettleBefore)) {
                                throw new ResponseStatusException(HttpStatus.CONFLICT, "Renewal settlement deadline has passed");
                            }
                            return damlRepository.findActiveAllocationById(request.getAllocationContractId())
                                    .thenCompose(allocationResult -> {
                                        var allocation = ensurePresent(allocationResult, "Active allocation not found for contract %s",
                                                request.getAllocationContractId());
                                        return completeRenewal(renewal.contractId, contractId, allocation, new Party(party), commandId);
                                    });
                        })));
    }

    private CompletableFuture<ResponseEntity<LicenseRenewalResult>> completeRenewal(
            ContractId<quickstart_licensing.licensing.license.LicenseRenewalRequest> renewalId,
            String licenseId, Contract<Allocation> allocation, Party provider, String commandId
    ) {
        var senderSpec = allocation.payload.getAllocation;
        var sides = senderSpec.getTransferLegSides;
        if (sides.size() != 1 || sides.get(0).getSide != TransferSide.SenderSide
                || sides.get(0).getOtherside.getOwner
                        .filter(owner -> owner.getParty.equals(provider.getParty)).isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Expected a sender allocation for the provider");
        }
        var side = sides.get(0);
        var sender = senderSpec.getAuthorizer;
        var receiver = side.getOtherside;
        var settlement = allocation.payload.getSettlement;
        var emptyMetadata = new splice_api_token_metadata_v1.splice.api.token.metadatav1.Metadata(Map.of());
        var emptyArgs = new ExtraArgs(new ChoiceContext(Map.of()), emptyMetadata);
        var actors = List.of(provider);

        // Scan supplies the context for the receipt that CompleteRenewal creates in the transaction.
        var receiptSide = new TransferLegSide(side.getTransferLegId, TransferSide.ReceiverSide,
                sender, side.getAmount, side.getInstrumentId, side.getMeta);
        var receiptSpec = new AllocationSpecification(senderSpec.getAdmin, receiver, List.of(receiptSide),
                senderSpec.getSettlementDeadline, Optional.empty(), false, emptyMetadata);
        var allocate = new AllocationFactory_Allocate(settlement, receiptSpec, Instant.now(),
                List.of(), emptyArgs, actors);

        // Only the sender's allocation exists yet. The ledger choice adds the receipt to the batch.
        var leg = new TransferLeg(side.getTransferLegId, sender, receiver,
                side.getAmount, side.getInstrumentId, side.getMeta);
        var settle = new SettlementFactory_SettleBatch(settlement, List.of(leg),
                List.of(new FinalizedAllocation(allocation.contractId, List.of(), Optional.empty())), actors, emptyArgs);

        return tokenStandardProxy.getAllocationFactoryContext(allocate)
                .thenCombine(tokenStandardProxy.getSettlementFactoryContext(settle), (receiptContext, settlementContext) -> {
                    var choice = new LicenseRenewalRequest_CompleteRenewal(
                            allocation.contractId, new ContractId<>(receiptContext.factoryId()), receiptContext.extraArgs(),
                            new ContractId<>(settlementContext.factoryId()), new ContractId<>(licenseId),
                            settlementContext.extraArgs());
                    var disclosures = new LinkedHashMap<String, CommandsOuterClass.DisclosedContract>();
                    receiptContext.disclosedContracts().forEach(contract -> disclosures.put(contract.getContractId(), contract));
                    settlementContext.disclosedContracts().forEach(contract -> disclosures.putIfAbsent(contract.getContractId(), contract));
                    return ledger.exerciseAndGetResult(renewalId, choice, commandId, List.copyOf(disclosures.values()));
                }).thenCompose(result -> result)
                .thenApply(newLicenseCid -> {
                    var result = new LicenseRenewalResult();
                    result.setLicenseId(newLicenseCid.getContractId);
                    return ResponseEntity.ok(result);
                });
    }

    @Override
    @WithSpan
    public CompletableFuture<ResponseEntity<String>> expireLicense(
            String contractId,
            String commandId,
            LicenseExpireRequest licenseExpireRequest
    ) {
        var ctx = tracingCtx(logger, "expireLicense",
                "contractId", contractId,
                "commandId", commandId
        );
        return auth.asAuthenticatedParty(party -> traceServiceCallAsync(ctx, () ->
                damlRepository.findLicenseById(contractId).thenCompose(optContract -> {
                    var license = ensurePresent(optContract, "License not found for contract %s", contractId);
                    var meta = licenseExpireRequest.getMeta().getData();
                    if (!party.equals(auth.getAppProviderPartyId())) {
                        meta = new HashMap<>(meta);
                        meta.put("Note", "Triggered by user request");
                    }
                    License_Expire choice = new License_Expire(new Party(auth.getAppProviderPartyId()), new splice_api_token_metadata_v1.splice.api.token.metadatav1.Metadata(meta));
                    return ledger.exerciseAndGetResult(license.contractId, choice, commandId)
                            .thenApply(result -> ResponseEntity.ok("License expired successfully"));
                })
        ));
    }

    private static License toLicenseApi(DamlRepository.LicenseWithRenewalRequests licenseContract) {
        var lp = licenseContract.license().payload;
        var now = Instant.now();
        License licenseApi = new License();
        licenseApi.setContractId(licenseContract.license().contractId.getContractId);
        licenseApi.setProvider(lp.getProvider.getParty);
        licenseApi.setUser(lp.getUser.getParty);
        licenseApi.setIsExpired(!lp.getExpiresAt.isAfter(now));
        var metaApi = new Metadata();
        var paramsApi = new LicenseParams();
        licenseApi.setParams(paramsApi.meta(metaApi.data(lp.getParams.getMeta.getValues)));
        licenseApi.setExpiresAt(toOffsetDateTime(lp.getExpiresAt));
        licenseApi.setUuid(lp.getUuid);
        licenseApi.setLicenseNum(lp.getLicenseNum.intValue());
        var renewalsApi = licenseContract.renewals().stream().map(renewalContract ->
                toLicenseRenewalRequestAPI(renewalContract, now)
        ).sorted(Comparator.comparing(LicenseRenewalRequest::getRequestedAt)).toList();
        licenseApi.setRenewalRequests(renewalsApi);
        return licenseApi;
    }

    private static LicenseRenewalRequest toLicenseRenewalRequestAPI(DamlRepository.LicenseRenewalRequestWithAllocationCid renewalContract, Instant now) {
        var rp = renewalContract.renewal().payload;
        var renewalApi = new LicenseRenewalRequest();
        renewalApi.setContractId(renewalContract.renewal().contractId.getContractId);
        renewalApi.setProvider(rp.getProvider.getParty);
        renewalApi.setUser(rp.getUser.getParty);
        renewalApi.setUuid(rp.getUuid);
        renewalApi.setLicenseNum(rp.getLicenseNum.intValue());
        renewalApi.setLicenseFeeAmount(rp.getLicenseFeeAmount);
        renewalApi.setDescription(rp.getDescription);
        renewalApi.setSettleBefore(toOffsetDateTime(rp.getSettleBefore));
        renewalApi.setRequestedAt(toOffsetDateTime(rp.getRequestedAt));
        renewalApi.setRequestId(rp.getRequestId);
        long micros = rp.getLicenseExtensionDuration.getMicroseconds;
        String approximateDays = (micros / 1_000_000 / 3600 / 24) + " days";
        renewalApi.setLicenseExtensionDuration(approximateDays);
        renewalApi.setSettleDeadlinePassed(!rp.getSettleBefore.isAfter(now));
        if (renewalContract.allocationCid().isPresent()) {
            renewalApi.setAllocationCid(renewalContract.allocationCid().get().getContractId);
        }
        return renewalApi;
    }

}
