# Pre-Generated DAR Files

The DAR files located in this folder are from **Splice** to match the current SDK version.

Source: https://github.com/hyperledger-labs/splice/tree/main/daml/dars

## Important Notes
- Ensure that you track SDK version updates to transition seamlessly.

The Token Standard V2 holding and transfer instruction DARs are from
[the Splice 0.10.2 revision pinned by this project](https://github.com/canton-network/splice/tree/e214318836feb7cee420dee33e85c7a6abbc7c04/daml/dars).

Licensing and its test support use the Token Standard V2 interfaces with
`MetadataV1`. The Amulet DAR used by the test support also bundles its upstream
dependencies, including V1 interfaces.
