// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

package com.digitalasset.quickstart.pqs;

import com.digitalasset.quickstart.repository.DamlRepository;
import com.digitalasset.transcode.Converter;
import com.digitalasset.transcode.MissingFieldsException;
import com.digitalasset.transcode.codec.json.JsonStringCodec;
import com.digitalasset.transcode.java.Template;
import com.digitalasset.transcode.schema.Dictionary;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import daml.Daml;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.CompletionException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

/** Runs Java PQS queries for the TypeScript backward compatibility tests. */
public final class PqsBackwardCompatibility {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final Dictionary<Converter<Object, String>> JSON_CODECS =
            com.digitalasset.transcode.java.Utils.getConverters(
                    Daml.ENTITIES, new JsonStringCodec(true, true, false));

    private PqsBackwardCompatibility() {}

    /** Runs repository reads against the isolated PostgreSQL schema and writes their JSON result. */
    public static void main(String[] args) throws Exception {
        String schema = required("PQS_BACKWARD_COMPATIBILITY_SCHEMA");
        if (!schema.matches("[a-z][a-z0-9_]*")) {
            throw new IllegalArgumentException("PQS_BACKWARD_COMPATIBILITY_SCHEMA is not a valid SQL identifier");
        }
        String host = required("POSTGRES_HOST");
        String port = required("POSTGRES_PORT");
        String database = required("POSTGRES_DATABASE");
        String username = required("POSTGRES_USERNAME");
        String password = required("POSTGRES_PASSWORD");

        var source = new DriverManagerDataSource();
        source.setDriverClassName("org.postgresql.Driver");
        source.setUrl("jdbc:postgresql://" + host + ":" + port + "/" + database);
        source.setUsername(username);
        source.setPassword(password);
        var connectionProperties = new java.util.Properties();
        connectionProperties.setProperty("currentSchema", schema);
        source.setConnectionProperties(connectionProperties);

        var repository = new DamlRepository(new Pqs(new JdbcTemplate(source)));
        var queries = JSON.createObjectNode();
        queries.set("installs", contracts(repository.findActiveAppInstalls().join()));
        queries.set("requests", contracts(repository.findActiveAppInstallRequests().join()));

        var lookups = queries.putObject("lookups");
        lookup(lookups, "install", repository.findAppInstallById("install-active").join());
        lookup(lookups, "request", repository.findAppInstallRequestById("request-active").join());
        lookup(lookups, "license", repository.findLicenseById("license-common").join());
        lookup(lookups, "renewal", repository.findActiveLicenseRenewalRequestById("renewal-common").join());
        lookup(lookups, "allocationRequest", repository.findActiveAllocationRequestById("renewal-common").join());
        lookup(lookups, "missing", repository.findLicenseById("missing").join());
        lookup(lookups, "archived", repository.findLicenseById("license-archived").join());
        lookup(lookups, "wrongTemplate", repository.findLicenseById("request-active").join());
        lookup(lookups, "blank", repository.findLicenseById("").join());

        var licenses = queries.putObject("licenses");
        for (String party : List.of(
                "common-provider", "common-user", "same-party", "outsider",
                "provider-a", "provider-b", "strict-provider")) {
            licenses.set(party, licenseGroups(repository.findActiveLicenses(party).join()));
        }

        // Required renewal fields are absent, which must fail Java payload decoding.
        try {
            repository.findActiveLicenseRenewalRequestById("renewal-invalid").join();
            queries.put("invalidRenewalRejected", false);
        } catch (CompletionException expected) {
            if (!(expected.getCause() instanceof MissingFieldsException)) {
                throw expected;
            }
            queries.put("invalidRenewalRejected", true);
        }

        Files.writeString(Path.of(required("PQS_BACKWARD_COMPATIBILITY_OUTPUT")), JSON.writeValueAsString(queries));
    }

    /** Reads a required connection setting without echoing its value on failure. */
    private static String required(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("Missing environment setting " + name);
        }
        return value;
    }

    /** Serializes typed Java contracts with the same JSON codec used to decode PQS rows. */
    private static <T extends Template> ArrayNode contracts(List<Contract<T>> values) throws Exception {
        var result = JSON.createArrayNode();
        for (var value : values) result.add(contract(value));
        return result;
    }

    /** Serializes one contract while preserving the typed payload fields. */
    private static <T extends Template> ObjectNode contract(Contract<T> value) throws Exception {
        var result = JSON.createObjectNode();
        result.put("contractId", value.contractId.getContractId);
        var encoded = JSON_CODECS.template(com.digitalasset.transcode.java.Utils.getTemplateIdByClass(value.payload.getClass()))
                .convert(value.payload);
        result.set("payload", JSON.readTree(encoded));
        return result;
    }

    /** Serializes an optional contract as JSON null when the Java repository returns empty. */
    private static <T extends Template> void lookup(
            ObjectNode result, String name, Optional<Contract<T>> value) throws Exception {
        if (value.isEmpty()) {
            result.putNull(name);
        } else {
            result.set(name, contract(value.get()));
        }
    }

    /** Serializes license groups and retains every Java renewal/allocation join row. */
    private static ArrayNode licenseGroups(List<DamlRepository.LicenseWithRenewalRequests> values)
            throws Exception {
        var result = JSON.createArrayNode();
        for (var value : values) {
            var license = JSON.createObjectNode();
            license.set("license", contract(value.license()));
            var renewals = license.putArray("renewals");
            for (var item : value.renewals()) {
                var renewal = JSON.createObjectNode();
                renewal.set("renewal", contract(item.renewal()));
                if (item.allocationCid().isPresent()) {
                    renewal.put("allocationCid", item.allocationCid().get().getContractId);
                } else {
                    renewal.putNull("allocationCid");
                }
                renewals.add(renewal);
            }
            result.add(license);
        }
        return result;
    }
}
