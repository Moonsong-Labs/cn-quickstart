// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

package com.digitalasset.quickstart.service;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.asyncDispatch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.digitalasset.quickstart.ledger.LedgerApi;
import com.digitalasset.quickstart.ledger.TokenStandardProxy;
import com.digitalasset.quickstart.pqs.Contract;
import com.digitalasset.quickstart.repository.DamlRepository;
import com.digitalasset.quickstart.security.AuthUtils;
import com.daml.ledger.api.v2.CommandsOuterClass;
import com.digitalasset.transcode.java.ContractId;
import com.digitalasset.transcode.java.Party;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.function.Function;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.mockito.ArgumentCaptor;
import org.springframework.http.ResponseEntity;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import quickstart_licensing.licensing.license.License;
import quickstart_licensing.licensing.license.LicenseRenewalRequest;
import splice_api_token_allocation_v2.splice.api.token.allocationv2.Allocation;
import splice_api_token_allocation_v2.splice.api.token.allocationv2.AllocationSpecification;
import splice_api_token_allocation_v2.splice.api.token.allocationv2.SettlementInfo;
import splice_api_token_allocation_v2.splice.api.token.allocationv2.TransferLegSide;
import splice_api_token_holding_v2.splice.api.token.holdingv2.Account;
import splice_api_token_metadata_v1.splice.api.token.metadatav1.Metadata;
import splice_api_token_metadata_v1.splice.api.token.metadatav1.ChoiceContext;
import splice_api_token_metadata_v1.splice.api.token.metadatav1.ExtraArgs;
import quickstart_licensing.licensing.license.LicenseRenewalRequest.LicenseRenewalRequest_CompleteRenewal;

class CompleteLicenseRenewalControllerTest {
    private static final String PROVIDER = "provider::test";
    private static final String USER = "user::test";
    private static final String RENEWAL_ID = "renewal-contract-id";
    private static final String ALLOCATION_ID = "allocation-contract-id";

    private final LedgerApi ledger = mock(LedgerApi.class);
    private final DamlRepository repository = mock(DamlRepository.class);
    private final TokenStandardProxy tokenStandardProxy = mock(TokenStandardProxy.class);
    private final AuthUtils auth = mock(AuthUtils.class);
    private MockMvc mockMvc;

    @BeforeEach
    @SuppressWarnings({"unchecked", "rawtypes"})
    void setUp() {
        doAnswer(invocation -> {
            Function<String, CompletableFuture<ResponseEntity<Object>>> action =
                    (Function) invocation.getArgument(0);
            return action.apply(PROVIDER);
        }).when(auth).asAdminParty(any(Function.class));
        mockMvc = MockMvcBuilders.standaloneSetup(
                new LicenseApiImpl(ledger, repository, tokenStandardProxy, auth)).build();
    }

    @ParameterizedTest
    @CsvSource({"0,P30D", "100,P0D", "100,PT0.000000001S", "100,invalid"})
    void invalidRenewalReturnsBadRequestWithoutCallingDependencies(String fee, String extension) throws Exception {
        var request = """
                {"licenseFeeCc":%s,"licenseExtensionDuration":"%s",
                 "settleBeforeDuration":"PT20M","description":"Test renewal"}
                """.formatted(fee, extension);
        var pending = mockMvc.perform(post("/licenses/{id}:renew", "license-contract-id")
                        .queryParam("commandId", "invalid-renewal")
                        .contentType("application/json")
                        .content(request))
                .andReturn();
        if (pending.getRequest().isAsyncStarted()) {
            pending = mockMvc.perform(asyncDispatch(pending)).andReturn();
        }
        assertEquals(400, pending.getResponse().getStatus());
        verifyNoInteractions(ledger, repository, tokenStandardProxy);
    }

    @Test
    void expiredRequestReturnsConflictWithoutLookingUpAllocationOrSubmitting() throws Exception {
        var renewal = renewal(Instant.now().minusSeconds(1));
        when(repository.findActiveLicenseRenewalRequestById(RENEWAL_ID))
                .thenReturn(CompletableFuture.completedFuture(Optional.of(
                        new Contract<>(new ContractId<>(RENEWAL_ID), renewal))));

        MvcResult pending = mockMvc.perform(post("/licenses/{id}:complete-renewal", "license-contract-id")
                        .queryParam("commandId", "expired-renewal")
                        .contentType("application/json")
                        .content(requestJson()))
                .andReturn();

        mockMvc.perform(asyncDispatch(pending)).andExpect(status().isConflict());
        verify(repository, never()).findActiveAllocationById(ALLOCATION_ID);
        verify(tokenStandardProxy, never()).getAllocationFactoryContext(any());
        verify(tokenStandardProxy, never()).getSettlementFactoryContext(any());
        verify(ledger, never()).exerciseAndGetResult(any(), any(), any(), any());
    }

    @Test
    @SuppressWarnings({"unchecked", "rawtypes"})
    void successfulRequestReturnsReplacementLicenseId() throws Exception {
        var renewal = renewal(Instant.now().plusSeconds(600));
        var allocation = allocation();
        when(repository.findActiveLicenseRenewalRequestById(RENEWAL_ID))
                .thenReturn(CompletableFuture.completedFuture(Optional.of(
                        new Contract<>(new ContractId<>(RENEWAL_ID), renewal))));
        when(repository.findActiveAllocationById(ALLOCATION_ID))
                .thenReturn(CompletableFuture.completedFuture(Optional.of(
                        new Contract<>(new ContractId<>(ALLOCATION_ID), allocation))));
        var extraArgs = new ExtraArgs(new ChoiceContext(Map.of()), new Metadata(Map.of()));
        var disclosure = CommandsOuterClass.DisclosedContract.newBuilder()
                .setContractId("shared-disclosure")
                .build();
        when(tokenStandardProxy.getAllocationFactoryContext(any()))
                .thenReturn(CompletableFuture.completedFuture(
                        new TokenStandardProxy.FactoryContext("allocation-factory-id", extraArgs, List.of(disclosure))));
        when(tokenStandardProxy.getSettlementFactoryContext(any()))
                .thenReturn(CompletableFuture.completedFuture(
                        new TokenStandardProxy.FactoryContext("settlement-factory-id", extraArgs, List.of(disclosure))));
        when(ledger.<LicenseRenewalRequest, ContractId<License>, LicenseRenewalRequest_CompleteRenewal>
                exerciseAndGetResult(any(), any(), any(), any()))
                .thenReturn(CompletableFuture.completedFuture(new ContractId<>("replacement-license-id")));
        MvcResult pending = mockMvc.perform(post("/licenses/{id}:complete-renewal", "license-contract-id")
                        .queryParam("commandId", "successful-renewal")
                        .contentType("application/json")
                        .content(requestJson()))
                .andReturn();
        mockMvc.perform(asyncDispatch(pending))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.licenseId").value("replacement-license-id"));
        verify(repository).findActiveAllocationById(ALLOCATION_ID);
        ArgumentCaptor<LicenseRenewalRequest_CompleteRenewal> choiceCaptor =
                ArgumentCaptor.forClass(LicenseRenewalRequest_CompleteRenewal.class);
        verify(ledger).<LicenseRenewalRequest, ContractId<License>, LicenseRenewalRequest_CompleteRenewal>
                exerciseAndGetResult(any(), choiceCaptor.capture(), any(), any());
        assertEquals("allocation-factory-id", choiceCaptor.getValue().getAllocationFactory.getContractId);
        assertEquals("settlement-factory-id", choiceCaptor.getValue().getSettlementFactory.getContractId);
        ArgumentCaptor<List<CommandsOuterClass.DisclosedContract>> disclosuresCaptor =
                ArgumentCaptor.forClass(List.class);
        verify(ledger).<LicenseRenewalRequest, ContractId<License>, LicenseRenewalRequest_CompleteRenewal>
                exerciseAndGetResult(any(), any(), any(), disclosuresCaptor.capture());
        assertEquals(List.of("shared-disclosure"),
                disclosuresCaptor.getValue().stream().map(CommandsOuterClass.DisclosedContract::getContractId).toList());
    }

    private static LicenseRenewalRequest renewal(Instant settleBefore) {
        return new LicenseRenewalRequest("request-id", new Party(PROVIDER), new Party(USER), "license-uuid",
                1L, BigDecimal.TEN,
                new splice_api_token_holding_v2.splice.api.token.holdingv2.InstrumentId(new Party("admin::test"), "Amulet"),
                new daml_stdlib_da_time_types.da.time.types.RelTime(86_400_000_000L), settleBefore,
                Instant.now(), "test renewal",
                new ContractId<>("settlement-reference"), Optional.empty());
    }

    private static Allocation allocation() {
        var provider = new Party(PROVIDER);
        var user = new Party(USER);
        var meta = new Metadata(Map.of());
        var authorizer = new Account(Optional.of(user), Optional.empty(), "");
        var receiver = new Account(Optional.of(provider), Optional.empty(), "");
        var side = new TransferLegSide("licenseFeePayment",
                splice_api_token_allocation_v2.splice.api.token.allocationv2.TransferSide.SenderSide,
                receiver, BigDecimal.TEN, "Amulet", meta);
        var spec = new AllocationSpecification(new Party("admin::test"), authorizer, List.of(side),
                Optional.of(Instant.now().plusSeconds(600)), Optional.empty(), false, meta);
        var settlement = new SettlementInfo(List.of(provider), "request-id",
                Optional.of(new ContractId<>("settlement-reference")), meta);
        return new Allocation(Optional.empty(), settlement, spec, List.of(), Instant.now(), 0L,
                Optional.empty(), Map.of(), meta);
    }

    private static String requestJson() {
        return "{\"renewalRequestContractId\":\"" + RENEWAL_ID
                + "\",\"allocationContractId\":\"" + ALLOCATION_ID + "\"}";
    }
}
