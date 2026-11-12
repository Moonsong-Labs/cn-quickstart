-- Model the active() result columns used by the Java and TypeScript queries.
CREATE TABLE contracts (
    contract_id text PRIMARY KEY,
    template_fqn text NOT NULL,
    payload jsonb NOT NULL,
    contract_key jsonb,
    archived_at_ix bigint
);

CREATE FUNCTION active(template_name text)
RETURNS TABLE (contract_id text, payload jsonb, contract_key jsonb)
LANGUAGE sql STABLE AS $$
    SELECT c.contract_id, c.payload, c.contract_key FROM contracts c
    WHERE c.template_fqn = template_name AND c.archived_at_ix IS NULL
$$;

INSERT INTO contracts (contract_id, template_fqn, payload, contract_key, archived_at_ix) VALUES
('install-1', 'quickstart-licensing:Licensing.AppInstall:AppInstall',
 '{"provider":"provider::test","user":"user::test","meta":{"values":{"description":"First installation"}},"numLicensesCreated":"9007199254740993"}', NULL, NULL),
('install-2', 'quickstart-licensing:Licensing.AppInstall:AppInstall',
 '{"provider":"provider::test","user":"another-user::test","meta":{"values":{}},"numLicensesCreated":"0"}', NULL, NULL),
('archived-install', 'quickstart-licensing:Licensing.AppInstall:AppInstall',
 '{"provider":"provider::test","user":"user::test","meta":{"values":{}},"numLicensesCreated":"2"}', NULL, 10),
('request-1', 'quickstart-licensing:Licensing.AppInstall:AppInstallRequest',
 '{"provider":"provider::test","user":"user::test","meta":{"values":{}}}', NULL, NULL),
('invalid-request', 'quickstart-licensing:Licensing.AppInstall:AppInstallRequest',
 '{"provider":42,"user":"user::test","meta":{"values":{}}}', NULL, NULL),
('renewal-1', 'quickstart-licensing:Licensing.License:LicenseRenewalRequest',
 '{"requestId":"renewal-ref","provider":"provider::test","user":"user::test","licenseNum":"9007199254740993","licenseFeeAmount":"123456789012345678.1234567890","licenseFeeInstrumentId":{"admin":"issuer::test","id":"TOKEN"},"licenseExtensionDuration":{"microseconds":"86400000000"},"prepareUntil":"2026-10-28T13:00:00.123456Z","settleBefore":"2026-10-28T14:00:00.123456Z","requestedAt":"2026-10-28T12:00:00.123456Z","description":"Renewal fixture"}', '{"provider":"provider::test","user":"user::test","requestId":"renewal-ref"}', NULL),
('license-key-match', 'quickstart-licensing:Licensing.License:License',
 '{"provider":"provider::test","user":"user::test","licenseNum":"9007199254740993","expiresAt":"2026-10-30T00:00:00Z","params":{"meta":{"values":{}}}}',
 '{"provider":"provider::test","user":"user::test","licenseNum":"9007199254740993"}', NULL),
('license-key-match-2', 'quickstart-licensing:Licensing.License:License',
 '{"provider":"provider::test","user":"user::test","licenseNum":"9007199254740993","expiresAt":"2026-10-31T00:00:00Z","params":{"meta":{"values":{}}}}',
 '{"provider":"provider::test","user":"user::test","licenseNum":"9007199254740993"}', NULL),
('license-key-extra-field', 'quickstart-licensing:Licensing.License:License',
 '{"provider":"provider::test","user":"user::test","licenseNum":"9007199254740993","expiresAt":"2026-10-31T00:00:00Z","params":{"meta":{"values":{}}}}',
 '{"provider":"provider::test","user":"user::test","licenseNum":"9007199254740993","extra":"ignored-by-decoder-but-not-equality"}', NULL),
('license-key-other-provider', 'quickstart-licensing:Licensing.License:License',
 '{"provider":"other-provider::test","user":"user::test","licenseNum":"9007199254740993","expiresAt":"2026-10-30T00:00:00Z","params":{"meta":{"values":{}}}}',
 '{"provider":"other-provider::test","user":"user::test","licenseNum":"9007199254740993"}', NULL),
('license-key-other-user', 'quickstart-licensing:Licensing.License:License',
 '{"provider":"provider::test","user":"another-user::test","licenseNum":"9007199254740993","expiresAt":"2026-10-30T00:00:00Z","params":{"meta":{"values":{}}}}',
 '{"provider":"provider::test","user":"another-user::test","licenseNum":"9007199254740993"}', NULL),
('license-key-other-number', 'quickstart-licensing:Licensing.License:License',
 '{"provider":"provider::test","user":"user::test","licenseNum":"9007199254740992","expiresAt":"2026-10-30T00:00:00Z","params":{"meta":{"values":{}}}}',
 '{"provider":"provider::test","user":"user::test","licenseNum":"9007199254740992"}', NULL),
('archived-license-key-match', 'quickstart-licensing:Licensing.License:License',
 '{"provider":"provider::test","user":"user::test","licenseNum":"9007199254740993","expiresAt":"2026-10-30T00:00:00Z","params":{"meta":{"values":{}}}}',
 '{"provider":"provider::test","user":"user::test","licenseNum":"9007199254740993"}', 10),
('null-license-key', 'quickstart-licensing:Licensing.License:License',
 '{"provider":"provider::test","user":"user::test","licenseNum":"9007199254740993","expiresAt":"2026-10-30T00:00:00Z","params":{"meta":{"values":{}}}}', NULL, NULL);
