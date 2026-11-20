// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

package com.digitalasset.quickstart.ledger;

import com.digitalasset.quickstart.config.LedgerConfig;
import com.digitalasset.quickstart.tokenstandard.openapi.ApiClient;
import com.digitalasset.quickstart.tokenstandard.openapi.ApiException;
import com.digitalasset.quickstart.tokenstandard.openapi.metadata.DefaultMetadataApi;
import com.digitalasset.quickstart.tokenstandard.openapi.metadata.model.GetRegistryInfoResponse;
import com.digitalasset.quickstart.utility.TracingUtils;
import com.digitalasset.quickstart.utility.TracingUtils.TracingContext;
import io.opentelemetry.instrumentation.annotations.WithSpan;

import com.daml.ledger.api.v2.CommandsOuterClass.DisclosedContract;
import com.daml.ledger.api.v2.ValueOuterClass.Identifier;
import com.digitalasset.transcode.Converter;
import com.digitalasset.transcode.codec.json.JsonStringCodec;
import com.digitalasset.transcode.java.Choice;
import com.digitalasset.transcode.schema.Dictionary;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.google.protobuf.ByteString;
import daml.Daml;
import splice_api_token_allocation_instruction_v2.splice.api.token.allocationinstructionv2.AllocationFactory.AllocationFactory_Allocate;
import splice_api_token_allocation_v2.splice.api.token.allocationv2.SettlementFactory.SettlementFactory_SettleBatch;
import splice_api_token_metadata_v1.splice.api.token.metadatav1.ChoiceContext;
import splice_api_token_metadata_v1.splice.api.token.metadatav1.ExtraArgs;
import splice_api_token_metadata_v1.splice.api.token.metadatav1.Metadata;

import java.net.URI;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import static com.digitalasset.quickstart.utility.ChoiceContextUtils.convertChoiceContextData;
import static com.digitalasset.quickstart.utility.TracingUtils.tracingCtx;

@Component
public class TokenStandardProxy {
    private final ApiClient apiClient;
    private final Dictionary<Converter<Object, String>> dto2Json =
            com.digitalasset.transcode.java.Utils.getConverters(Daml.ENTITIES, new JsonStringCodec(true, true, false));
    private final DefaultMetadataApi metadataApi;

    private static final Logger logger = LoggerFactory.getLogger(TokenStandardProxy.class);

    public TokenStandardProxy(LedgerConfig ledgerConfig) {
        this.apiClient = new ApiClient();
        apiClient.updateBaseUri(ledgerConfig.getRegistryBaseUri());
        this.metadataApi = new DefaultMetadataApi(apiClient);
    }

    @WithSpan
    public CompletableFuture<String> getRegistryAdminId() {
        var ctx = tracingCtx(logger, "getRegistryAdminId");
        return trace(ctx, () ->
                metadataApi.getRegistryInfo().thenApply(GetRegistryInfoResponse::getAdminId)
        );
    }

    public record FactoryContext(String factoryId, ExtraArgs extraArgs, List<DisclosedContract> disclosedContracts) {}

    @WithSpan
    public CompletableFuture<FactoryContext> getAllocationFactoryContext(AllocationFactory_Allocate choice) {
        return getFactoryContext("/registry/allocation-instruction/v2/allocation-factory", choice);
    }

    @WithSpan
    public CompletableFuture<FactoryContext> getSettlementFactoryContext(SettlementFactory_SettleBatch choice) {
        return getFactoryContext("/registry/allocation/v2/settlement-factory", choice);
    }

    private CompletableFuture<FactoryContext> getFactoryContext(String path, Choice<?, ?> choice) {
        var mapper = apiClient.getObjectMapper();
        var arguments = dto2Json.choiceArgument(choice.templateId(), choice.choiceName()).convert(choice);
        try {
            var body = mapper.createObjectNode();
            body.set("choiceArguments", mapper.readTree(arguments));
            body.put("excludeDebugFields", true);
            var request = HttpRequest.newBuilder(URI.create(apiClient.getBaseUri().replaceFirst("/+$", "") + path))
                    .timeout(Duration.ofSeconds(30))
                    .header("Content-Type", "application/json")
                    .header("Accept", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(body.toString()))
                    .build();
            return apiClient.getHttpClient().sendAsync(request, HttpResponse.BodyHandlers.ofString())
                    .thenApply(response -> {
                        if (response.statusCode() != 200) {
                            throw new IllegalStateException("Registry " + path + " returned HTTP " + response.statusCode());
                        }
                        return decodeFactoryContext(response.body());
                    });
        } catch (JsonProcessingException e) {
            return CompletableFuture.failedFuture(e);
        }
    }

    private FactoryContext decodeFactoryContext(String body) {
        try {
            RegistryFactoryResponse result = apiClient.getObjectMapper().readerFor(RegistryFactoryResponse.class)
                    .without(com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
                    .with(com.fasterxml.jackson.databind.DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS)
                    .readValue(body);
            var context = result.choiceContext();
            var args = new ExtraArgs(
                    new ChoiceContext(convertChoiceContextData(context.choiceContextData())), new Metadata(Map.of()));
            return new FactoryContext(result.factoryId(), args,
                    context.disclosedContracts().stream().map(RegistryDisclosure::toLedgerContract).toList());
        } catch (JsonProcessingException e) {
            throw new CompletionException(e);
        }
    }

    private record RegistryFactoryResponse(String factoryId, RegistryChoiceContext choiceContext) {}

    private record RegistryChoiceContext(Map<String, Object> choiceContextData,
                                         List<RegistryDisclosure> disclosedContracts) {}

    private record RegistryDisclosure(String templateId, String contractId, String createdEventBlob,
                                      String synchronizerId) {
        DisclosedContract toLedgerContract() {
            var parts = templateId.split(":", 3);
            if (parts.length != 3) {
                throw new IllegalArgumentException("Invalid template ID in registry disclosure: " + templateId);
            }
            var builder = DisclosedContract.newBuilder()
                    .setTemplateId(Identifier.newBuilder().setPackageId(parts[0]).setModuleName(parts[1])
                            .setEntityName(parts[2]))
                    .setContractId(contractId)
                    .setCreatedEventBlob(ByteString.copyFrom(Base64.getDecoder().decode(createdEventBlob)));
            if (synchronizerId != null) {
                builder.setSynchronizerId(synchronizerId);
            }
            return builder.build();
        }
    }

    private <T> CompletableFuture<T> trace(
            TracingContext ctx,
            ThrowingSupplier<CompletableFuture<T>> supplier) {
        return TracingUtils.trace(ctx, () -> {
            try {
                return supplier.get();
                // should not be possible - OpenAPI codegen adds false checked `throws` declaration
            } catch (ApiException e) {
                throw new CompletionException(e);
            }
        });
    }

    @FunctionalInterface
    private interface ThrowingSupplier<T> {
        T get() throws ApiException;
    }
}
