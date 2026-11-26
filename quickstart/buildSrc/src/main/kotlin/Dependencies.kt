// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

object Deps {

    // Use getters to propagate .env file dependency version changes to gradle

    object daml {
        val version get() = VersionFiles.dotenv["DAML_RUNTIME_VERSION"]
        val proto get() = "com.daml:ledger-api-proto:$version"
    }

    object grpc {
        val version get() = "1.67.1"
        val commonsProto get() = "com.google.api.grpc:proto-google-common-protos:2.42.0"
        val stub get() = "io.grpc:grpc-stub:$version"
        val protobuf get() = "io.grpc:grpc-protobuf:$version"
        val api get() = "io.grpc:grpc-api:$version"
        val netty get() = "io.grpc:grpc-netty:$version"
    }

    object transcode {
        /**
         * Newest 3.7 release that publishes the Java codegen plugin.
         * 3.7.3 publishes the ledger API proto and the codecs, and not this plugin.
         */
        val version get() = "3.7.2"

        /** Gradle plugin that generates the Java bindings from a DAR. */
        val plugin get() = "com.daml.codegen-java-daml3:com.daml.codegen-java-daml3.gradle.plugin:$version"
        /** Runtime linked by the classes that plugin writes. */
        val codegenJavaRuntime get() = "com.daml:transcode-codegen-java-runtime_3:$version"
        /** Protobuf codec for ledger values. */
        val protoJava get() = "com.daml:transcode-codec-proto-java_3:$version"
        /** JSON codec for ledger values. */
        val protoJson get() = "com.daml:transcode-codec-json_3:$version"
    }

    object springBoot {
        val version get() = "3.4.2"
        val web get() = "org.springframework.boot:spring-boot-starter-web:$version"
        val jdbc get() = "org.springframework.boot:spring-boot-starter-jdbc:$version"
        val oauth2Client get() = "org.springframework.boot:spring-boot-starter-oauth2-client:$version"
        val oauth2ResourceServer get() = "org.springframework.boot:spring-boot-starter-oauth2-resource-server:$version"
        val security get() = "org.springframework.boot:spring-boot-starter-security:$version"
        val actuator get() = "org.springframework.boot:spring-boot-starter-actuator:$version"
        val test get() = "org.springframework.boot:spring-boot-starter-test:$version"
    }
}
