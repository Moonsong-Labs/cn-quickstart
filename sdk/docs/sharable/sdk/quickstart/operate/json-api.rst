.. _quickstart-json-ledger-api:

Using the JSON Ledger API
=========================

Overview
--------

You are ready to extend the CN Quickstart to interact directly with your LocalNet.
You'll learn how to programmatically create parties, upload DARs, create contracts,
and integrate with Canton Coin (Amulet) using OAuth2 authentication against your running LocalNet.
By the end, you'll have the hands-on experience with critical API patterns needed to build your own Canton Network applications.

Prerequisites
-------------

This guide requires the Daml Package Manager (DPM).
Follow installation instructions at `DPM <https://docs.canton.network/sdks-tools/cli-tools/dpm>`__.

You should have also finished the Quickstart installation and Explore the demo tutorial.
We also recommend reading the developer journey lifecycle to better understand how Quickstart bootstraps your Canton Network development by providing the tooling you will need for any CN app.

LocalNet interaction expectations vs Explore the demo (using app vs developer skills)
-------------------------------------------------------------------------------------

In the demo, you interacted with LocalNet through the web interface as a user.
Now you'll take control of LocalNet directly through APIs,
learning to programmatically manage the network infrastructure that will become your foundation for building on ScratchNet, TestNet, and beyond.

Project directory structure
---------------------------

The CN Quickstart contains the following directory structure:

.. code-block:: text

   cn-quickstart/
   ├── daml/                  # daml contracts and project files
   │   ├── User.daml          # user management
   │   ├── Provider.daml      # license provider  
   │   └── License.daml       # license management
   ├── backend/               # API integration points
   ├── frontend/              # UI 
   └── config/                # LocalNet settings, including OAuth2 and port settings

You'll work primarily in daml/ to extend the licensing contracts with a new LicenseHistory.daml contract that tracks ownership transfers

LocalNet env & auth
-------------------

Env verification
~~~~~~~~~~~~~~~~

The Quickstart application should be built and running. Verify that all services are operational in the terminal with ``make status``.

.. image:: images/terminal-make-status.png
   :alt: Make status

Port mappings
~~~~~~~~~~~~~

Security consideration
^^^^^^^^^^^^^^^^^^^^^^

The port mappings for ``LocalNet`` expose the ``AdminAPI`` port and the ``Postgres`` port,
both of which would normally be a security risk.
However, having direct access to these ports when running on a local developer's machine can be useful.
These ports should not be exposed when preparing deployment configurations for non-local deployments.
The port suffixes are defined as environment variables.
For any port mappings you wish to disable,
you can find and remove the relevant Docker ``port``: entry in the appropriate file.

JSON API ports
^^^^^^^^^^^^^^

(2975, 3975, 4975): Daml ops and smart contract deployment

Validator API ports
^^^^^^^^^^^^^^^^^^^

(2903, 3903, 4903): status monitoring

OAuth2 & token mgmt
~~~~~~~~~~~~~~~~~~~

Overview
^^^^^^^^

LocalNet uses Keycloak at http://keycloak.localhost:8082 for OAuth2 authentication with two realms: ``AppUser`` and ``AppProvider``.
You can login to Keycloak at this port by using the username and password ``admin``.
Read ``ref:keycloak-in-cnqs`` To learn more about Keycloak.

.. image:: images/keycloak-admin-login.png
   :alt: Keycloak admin login

JSON API Tutorial
-----------------

In this tutorial, you're making API calls to simulate the steps taken in the Quickstart web app by requesting JWT tokens,
then include them as Bearer tokens in API calls.
Start the application and tools from the ``quickstart/`` directory.

Begin capture logs
~~~~~~~~~~~~~~~~~~

``make capture-logs``

Allow capture logs to run in its terminal window.
In a new terminal window, run the Quickstart application with ``make start``.
Once complete, this can become your working terminal window.
After ``make start`` completes, open a new terminal window to initiate lnav.
Start lnav with ``lnav logs/*.clog`` to capture and analyze logs.
If there are no clogs you might try running ``make stop && make clean-all`` then rerunning ``make start``.
Alternatively, you can begin this guide to make transactions on the ledger.
This should cause clogs to self-generate.
This command launches lnav to trace transactions, debug issues, and monitor system behavior as you work.
Keep lnav running in its terminal window.

Lnav Guidance
^^^^^^^^^^^^^

For detailed guidance on navigating lnav, and understanding the custom format, see ``Debugging and troubleshooting with lnav``.

Get a Token
~~~~~~~~~~~

Use the AppUser validator client to get a token.

.. code-block:: bash
   :name: cf-docs-snippet-cn-quickstart-json-api-get-user-admin-token-start

   export USER_ADMIN_TOKEN=$(curl -fsS "http://keycloak.localhost:8082/realms/AppUser/protocol/openid-connect/token" \
     -H "Content-Type: application/x-www-form-urlencoded" \
     -d "client_id=app-user-validator" \
     -d "client_secret=6m12QyyGl81d9nABWQXMycZdXho6ejEX" \
     -d "grant_type=client_credentials" \
     -d "scope=openid" | jq -r .access_token)

.. cf-docs-snippet-cn-quickstart-json-api-get-user-admin-token-end

(client_secret is set in oauth2.env and AppUser-realm.json)

An empty return indicates success.

Verify the token

.. code-block:: bash
   :name: cf-docs-snippet-cn-quickstart-json-api-echo-user-admin-token-start

   echo $USER_ADMIN_TOKEN

.. cf-docs-snippet-cn-quickstart-json-api-echo-user-admin-token-end

Use the token
~~~~~~~~~~~~~

List existing parties and include the token in API requests

.. code-block:: bash
   :name: cf-docs-snippet-cn-quickstart-json-api-list-parties-start

   curl -H "Authorization: Bearer $USER_ADMIN_TOKEN" \
     http://localhost:2975/v2/parties

.. cf-docs-snippet-cn-quickstart-json-api-list-parties-end

View Party and DSO activity in lnav
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

View Party activity in lnav with the ``filter-in`` command followed by the app provider or app user IDs.

.. code-block:: text
   :name: cf-docs-snippet-cn-quickstart-json-api-lnav-filter-app-provider-start

   :filter-in APP_PROVIDER_ID

.. cf-docs-snippet-cn-quickstart-json-api-lnav-filter-app-provider-end

You can also view DSO activity in lnav using the DSO ID.

.. code-block:: text
   :name: cf-docs-snippet-cn-quickstart-json-api-lnav-filter-dso-start

   :filter-in DSO_ID

.. cf-docs-snippet-cn-quickstart-json-api-lnav-filter-dso-end

Save the ``party`` values for ``app-provider`` as APP_PROVIDER_PARTY and ``app-user`` as APP_USER_PARTY.

.. code-block:: bash
   :name: cf-docs-snippet-cn-quickstart-json-api-save-app-parties-start

   APP_PROVIDER_PARTY=$(curl -s -H "Authorization: Bearer $USER_ADMIN_TOKEN" http://localhost:2975/v2/parties | \
     jq -r '.partyDetails[] | select(.party | startswith("app_provider_quickstart-")) | .party')
   
   APP_USER_PARTY=$(curl -s -H "Authorization: Bearer $USER_ADMIN_TOKEN" http://localhost:2975/v2/parties | \
     jq -r '.partyDetails[] | select(.party | startswith("app_user_quickstart-")) | .party')
   
   echo "APP_PROVIDER_PARTY: $APP_PROVIDER_PARTY"
   echo "APP_USER_PARTY: $APP_USER_PARTY"

.. cf-docs-snippet-cn-quickstart-json-api-save-app-parties-end

Save the DSO Party
~~~~~~~~~~~~~~~~~~

.. code-block:: bash
   :name: cf-docs-snippet-cn-quickstart-json-api-save-dso-party-start

   DSO_PARTY=$(curl -s "http://localhost:2975/v2/parties" \
     -H "Authorization: Bearer $USER_ADMIN_TOKEN" | \
     jq -r '.partyDetails[] | select(.party | startswith("DSO::")) | .party')
   echo "DSO Party: $DSO_PARTY"

.. cf-docs-snippet-cn-quickstart-json-api-save-dso-party-end

You're now ready to make authenticated JSON API calls to your LocalNet.

Token management troubleshooting
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Tokens expire after a period. If API calls return ``Cannot iterate over null`` or ``401 Unauthorized``,
regenerate your token with the command above. For production patterns,
see ``quickstart/docker/modules/splice-onboarding/docker/utils.sh`` for token management utilities.

Create a party
--------------

Create a new party on the AppUser validator.

.. code-block:: bash
   :name: cf-docs-snippet-cn-quickstart-json-api-create-party-request-start

   curl -X POST http://localhost:2975/v2/parties \
     -H "Authorization: Bearer $USER_ADMIN_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
       "partyIdHint": "Alice"
     }'

.. cf-docs-snippet-cn-quickstart-json-api-create-party-request-end

You can use any name as the ``partyIdHint`` value.
Canton may append additional characters for uniqueness.

Success Response:

.. code-block:: json
   :name: cf-docs-snippet-cn-quickstart-json-api-create-party-response-start

   {
     "partyDetails": {
       "party": "Alice::122091f5d8d174bc0d624616d4f366904f8d4c56d56e33508878db3156c3dd9b8ae9",
       "isLocal": true,
       "localMetadata": { "resourceVersion": "0", "annotations": {} },
       "identityProviderId": ""
     }
   }

.. cf-docs-snippet-cn-quickstart-json-api-create-party-response-end

See the new participant Alice in lnav
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

.. code-block:: text
   :name: cf-docs-snippet-cn-quickstart-json-api-lnav-filter-alice-name-start

   :filter-in: Alice

.. cf-docs-snippet-cn-quickstart-json-api-lnav-filter-alice-name-end

or

.. code-block:: text
   :name: cf-docs-snippet-cn-quickstart-json-api-lnav-filter-alice-id-start

   :filter-in: ALICE_ID

.. cf-docs-snippet-cn-quickstart-json-api-lnav-filter-alice-id-end

Troubleshoot common party creation issues
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

``A security-sensitive error has been received`` or ``401 Unauthorized``: Token expired - regenerate with the OAuth2 command

``INVALID_ARGUMENT``, ``Party already exists``, or ``400 Bad Request``: Party might already exist - check with:

.. code-block:: bash
   :name: cf-docs-snippet-cn-quickstart-json-api-list-parties-troubleshoot-start

   curl -X GET http://localhost:2975/v2/parties \
     -H "Authorization: Bearer $USER_ADMIN_TOKEN"

.. cf-docs-snippet-cn-quickstart-json-api-list-parties-troubleshoot-end

Upload a DAR
------------

Upload the prebuilt licensing DAR to the validator.

.. code-block:: bash
   :name: cf-docs-snippet-cn-quickstart-json-api-upload-dar-request-start

   curl -X POST http://localhost:2975/v2/packages \
     -H "Content-Type: application/octet-stream" \
     -H "Authorization: Bearer $USER_ADMIN_TOKEN" \
     --data-binary @./daml/licensing/.daml/dist/quickstart-licensing-0.0.1.dar

.. cf-docs-snippet-cn-quickstart-json-api-upload-dar-request-end

Success looks like:

.. code-block:: json
   :name: cf-docs-snippet-cn-quickstart-json-api-upload-dar-response-start

   {}

.. cf-docs-snippet-cn-quickstart-json-api-upload-dar-response-end

DAR Upload issues
~~~~~~~~~~~~~~~~~

404 Not Found: Verify DAR path is correct from your current directory
413 Payload Too Large: DAR exceeds size limit
409 Conflict: Package already uploaded
curl: (52) Empty reply from server: Network issue - retry
Check lnav for detailed upload logs and any processing errors.

Create a contract on LocalNet
------------------------------

Inspect the DAR to find the package hash. Find and save the package ID, a 64-character hex string.

.. code-block:: bash
   :name: cf-docs-snippet-cn-quickstart-json-api-inspect-dar-start

   dpm damlc inspect-dar daml/licensing/.daml/dist/quickstart-licensing-0.0.1.dar

.. cf-docs-snippet-cn-quickstart-json-api-inspect-dar-end

We suggest copying and pasting this command for your convenience.
If you choose to type it out, you may need to type the full directory without the use of autocomplete.

The desired value may vary between SDK versions.
You can identify the main package by the project name in the package list.

The format follows:

.. code-block:: text

   <project-name>-<version>-<package-id>

At the time of publication, the repeating string of ``b59ffbf847ac36fee1a4a743864274c5d8ab6f02ea8899f49fb5347e9978543f`` is the project ID that we seek.

Alternatively, if you're querying the ``quickstart-licensing`` DAR, as we do in this tutorial, you can quickly grep and save the project ID with:

.. code-block:: bash
   :name: cf-docs-snippet-cn-quickstart-json-api-save-package-id-start

   PACKAGE_ID=$(dpm damlc inspect-dar daml/licensing/.daml/dist/quickstart-licensing-0.0.1.dar | grep "quickstart-licensing-0.0.1-" | grep -v "dalf" | tail -1 | awk '{print $2}' | tr -d '"')
   
   echo $PACKAGE_ID

.. cf-docs-snippet-cn-quickstart-json-api-save-package-id-end

If you'd like to query a different DAR then change the file path.

See the DAR activity in ``lnav`` by filtering the package ID
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

.. code-block:: text
   :name: cf-docs-snippet-cn-quickstart-json-api-lnav-filter-package-id-start

   :filter-in PACKAGE_ID

.. cf-docs-snippet-cn-quickstart-json-api-lnav-filter-package-id-end

Create the Contract
~~~~~~~~~~~~~~~~~~~

Renew your token to query the participant:

.. code-block:: bash
   :name: cf-docs-snippet-cn-quickstart-json-api-renew-user-admin-token-start

   USER_ADMIN_TOKEN=$(curl -fsS "http://keycloak.localhost:8082/realms/AppUser/protocol/openid-connect/token" \
     -H 'Content-Type: application/x-www-form-urlencoded' \
     -d 'client_id=app-user-validator' \
     -d 'client_secret=6m12QyyGl81d9nABWQXMycZdXho6ejEX' \
     -d 'grant_type=client_credentials' \
     -d 'scope=openid' | jq -r .access_token)

.. cf-docs-snippet-cn-quickstart-json-api-renew-user-admin-token-end

Get PROVIDER_ADMIN_TOKEN
~~~~~~~~~~~~~~~~~~~~~~~~

.. code-block:: bash
   :name: cf-docs-snippet-cn-quickstart-json-api-get-provider-admin-token-start

   PROVIDER_ADMIN_TOKEN=$(curl -f -s -S "http://keycloak.localhost:8082/realms/AppProvider/protocol/openid-connect/token" \
     -H 'Content-Type: application/x-www-form-urlencoded' \
     -d 'client_id=app-provider-validator' \
     -d 'client_secret=AL8648b9SfdTFImq7FV56Vd0KHifHBuC' \
     -d 'grant_type=client_credentials' \
     -d 'scope=openid' | jq -r .access_token)

.. cf-docs-snippet-cn-quickstart-json-api-get-provider-admin-token-end

Get the user token:

.. code-block:: bash
   :name: cf-docs-snippet-cn-quickstart-json-api-get-user-token-start

   USER_TOKEN=$(curl -f -s -S "http://keycloak.localhost:8082/realms/AppUser/protocol/openid-connect/token" \
     -H 'Content-Type: application/x-www-form-urlencoded' \
     -d 'client_id=app-user-unsafe' \
     -d 'username=app-user' \
     -d 'password=abc123' \
     -d 'grant_type=password' \
     -d 'scope=openid' | jq -r .access_token)

.. cf-docs-snippet-cn-quickstart-json-api-get-user-token-end

Create the ``AppInstallRequest``:

.. code-block:: bash
   :name: cf-docs-snippet-cn-quickstart-json-api-create-app-install-request-start

   curl -X POST "http://localhost:2975/v2/commands/submit-and-wait" \
     -H "Authorization: Bearer $USER_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
       "commands": [{
         "CreateCommand": {
           "templateId": "'"$PACKAGE_ID"':Licensing.AppInstall:AppInstallRequest",
           "createArguments": {
             "provider": "'"$APP_PROVIDER_PARTY"'",
             "user": "'"$APP_USER_PARTY"'",
             "meta": {"values": {}}
           }
         }
       }],
       "workflowId": "install-request",
       "applicationId": "'"$APP_USER_ID"'",
       "commandId": "req-'"$(date +%s%N)"'",
       "deduplicationPeriod": {"Empty": {}},
       "actAs": ["'"$APP_USER_PARTY"'"],
       "readAs": [],
       "submissionId": "install-request",
       "disclosedContracts": [],
       "domainId": "",
       "packageIdSelectionPreference": []
     }'

.. cf-docs-snippet-cn-quickstart-json-api-create-app-install-request-end

The return shows your first contract made on LocalNet via the JSON API ledger!

The return looks something like:

.. code-block::
   :name: cf-docs-snippet-cn-quickstart-json-api-create-app-install-request-response-start

   {
     "updateId": "122059bdefac3665d7a0e933017e8b4f68b5668945ca3ecca219bee89741f10b28b1",
     "completionOffset": 1666
   }

.. cf-docs-snippet-cn-quickstart-json-api-create-app-install-request-response-end

updateId: A unique identifier for this ledger update/transaction. You can use this to track this specific operation in logs.
completionOffset: The position in the ledger where this transaction was committed.
For example, 1666 means this was the 1,666th transaction on this participant.

See the contract creation in lnav by filtering for ``AppInstallRequest`` or filter by the ``updateId`` value.

.. code-block:: text
   :name: cf-docs-snippet-cn-quickstart-json-api-lnav-filter-app-install-request-start

   :filter-in AppInstallRequest

.. cf-docs-snippet-cn-quickstart-json-api-lnav-filter-app-install-request-end

The results show detailed information including the trace IDs. Trace IDs can be used to follow related activity throughout the complete business operation.

.. image:: images/lnav-appinstallrequest.png
   :alt: lnav AppInstallRequest

In this screenshot, ``deb9fe66dfb7990e5268f3690dbe53e8`` and ``61af0b8172d45909f9f8e8c5c4d46f16`` are examples of trace IDs.

Access the contract in daml shell
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Open ``daml shell`` to query for the created contract.
In a new terminal window, from the ``quickstart/`` directory run ``make shell``

Query the ``AppInstallRequest`` contract:

.. code-block:: text
   :name: cf-docs-snippet-cn-quickstart-json-api-daml-shell-active-app-install-request-start

   active quickstart-licensing:Licensing.AppInstall:AppInstallRequest

.. cf-docs-snippet-cn-quickstart-json-api-daml-shell-active-app-install-request-end

.. image:: images/shell-appinstallrequest-active.png
   :alt: daml shell AppInstallRequest active

Use the displayed portion of the contract ID to display the contract details.

In ``daml shell`` run the command contract followed by your unique Contract ID.
In this case: ``contract 0044e9b`` until there are no other contract options.
Press tab to complete the contract ID and enter to see the contract details.

.. image:: images/shell-appinstallrequest-contract.png
   :alt: daml shell AppInstallRequest contract

Copy and save the contract ID to a new ``INSTALL_REQ_CID`` variable in the previous working terminal.

.. code-block:: bash
   :name: cf-docs-snippet-cn-quickstart-json-api-save-install-request-cid-start

   INSTALL_REQ_CID="###"

.. cf-docs-snippet-cn-quickstart-json-api-save-install-request-cid-end

Find the AppInstallRequest contract
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Get the provider user token as a password grant for party rights.

.. code-block:: bash
   :name: cf-docs-snippet-cn-quickstart-json-api-get-provider-token-start

   PROVIDER_TOKEN=$(curl -f -s -S "http://keycloak.localhost:8082/realms/AppProvider/protocol/openid-connect/token" \
     -H 'Content-Type: application/x-www-form-urlencoded' \
     -d 'client_id=app-provider-unsafe' \
     -d 'username=app-provider' \
     -d 'password=abc123' \
     -d 'grant_type=password' \
     -d 'scope=openid' | jq -r .access_token)

.. cf-docs-snippet-cn-quickstart-json-api-get-provider-token-end

Exercise the Accept choice on the first contract:

.. code-block:: bash
   :name: cf-docs-snippet-cn-quickstart-json-api-accept-app-install-request-start

   JSON_PAYLOAD=$(cat <<EOF
   {
     "commands": [{
       "ExerciseCommand": {
         "templateId": "$PACKAGE_ID:Licensing.AppInstall:AppInstallRequest",
         "contractId": "$INSTALL_REQ_CID",
         "choice": "AppInstallRequest_Accept",
         "choiceArgument": {
           "installMeta": {"values": {}},
           "meta": {"values": {}}
         }
       }
     }],
     "workflowId": "accept-install",
     "applicationId": "app-provider-app",
     "commandId": "accept-$(date +%s%N)",
     "actAs": ["$APP_PROVIDER_PARTY"],
     "readAs": [],
     "submissionId": "accept-install",
     "disclosedContracts": [],
     "domainId": "",
     "packageIdSelectionPreference": []
   }
   EOF
   )
   
   curl -X POST "http://localhost:3975/v2/commands/submit-and-wait" \
     -H "Authorization: Bearer $PROVIDER_TOKEN" \
     -H "Content-Type: application/json" \
     -d "$JSON_PAYLOAD"

.. cf-docs-snippet-cn-quickstart-json-api-accept-app-install-request-end

SUCCESS looks like

.. code-block:: json
   :name: cf-docs-snippet-cn-quickstart-json-api-accept-app-install-request-response-start

   {"updateId":"1220064a62356625ab7338564daedd21487749a7fcd21ad1d3a659b9131e9aadc246","completionOffset":109}

.. cf-docs-snippet-cn-quickstart-json-api-accept-app-install-request-response-end

See the contract in lnav
~~~~~~~~~~~~~~~~~~~~~~~~

.. code-block:: text
   :name: cf-docs-snippet-cn-quickstart-json-api-lnav-filter-app-install-request-lowercase-start

   :filter-in appinstallrequest

.. cf-docs-snippet-cn-quickstart-json-api-lnav-filter-app-install-request-lowercase-end

You can exercise the accept choice exactly once.
After that you will receive an error because the contract has been accepted.

Generate a token for the app provider
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

.. code-block:: bash
   :name: cf-docs-snippet-cn-quickstart-json-api-generate-provider-admin-token-start

   PROVIDER_ADMIN_TOKEN=$(curl -fsS "http://keycloak.localhost:8082/realms/AppProvider/protocol/openid-connect/token" \
     -H 'Content-Type: application/x-www-form-urlencoded' \
     -d 'client_id=app-provider-validator' \
     -d 'client_secret=AL8648b9SfdTFImq7FV56Vd0KHifHBuC' \
     -d 'grant_type=client_credentials' \
     -d 'scope=openid' | jq -r .access_token)

.. cf-docs-snippet-cn-quickstart-json-api-generate-provider-admin-token-end

Check if ``app-provider`` user exists

.. code-block:: bash
   :name: cf-docs-snippet-cn-quickstart-json-api-check-app-provider-user-start

   curl -s "http://localhost:3975/v2/users" \
     -H "Authorization: Bearer $PROVIDER_ADMIN_TOKEN" | jq '.users[] | select(.metadata.annotations.username == "app-provider")'

.. cf-docs-snippet-cn-quickstart-json-api-check-app-provider-user-end

If the ``app-provider`` user exists, get the party and verify it's set (if it fails review the previous steps):

.. code-block:: bash
   :name: cf-docs-snippet-cn-quickstart-json-api-get-app-provider-party-start

   APP_PROVIDER_USER_ID=$(curl -s "http://localhost:3975/v2/users" \
     -H "Authorization: Bearer $PROVIDER_ADMIN_TOKEN" | \
     jq -r '.users[] | select(.metadata.annotations.username == "app-provider") | .id')
   
   echo "APP_PROVIDER_USER_ID: $APP_PROVIDER_USER_ID"

.. cf-docs-snippet-cn-quickstart-json-api-get-app-provider-party-end

The ``APP_PROVIDER_USER_ID`` should equal the "id" value.

Return to ``daml shell`` to query for the ``AppInstall`` contract ID
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

.. code-block:: text
   :name: cf-docs-snippet-cn-quickstart-json-api-daml-shell-active-app-install-start

   active quickstart-licensing:Licensing.AppInstall:AppInstall

.. cf-docs-snippet-cn-quickstart-json-api-daml-shell-active-app-install-end

Use the ``contract`` command as before to isolate and copy the complete contract id.

Back to the shell terminal
~~~~~~~~~~~~~~~~~~~~~~~~~~

.. code-block:: bash
   :name: cf-docs-snippet-cn-quickstart-json-api-save-app-install-cid-start

   APP_INSTALL_CID="..."

.. cf-docs-snippet-cn-quickstart-json-api-save-app-install-cid-end

You may verify that all of your variables are set:

.. code-block:: bash
   :name: cf-docs-snippet-cn-quickstart-json-api-verify-variables-start

   echo "User Party: $APP_USER_PARTY"
   echo "Provider Party: $APP_PROVIDER_PARTY"
   echo "App Provider User ID: $APP_PROVIDER_USER_ID"
   echo "Provider Token: ${PROVIDER_TOKEN:0:50}..."
   echo "Package ID: $PACKAGE_ID"
   echo "DSO Party: $DSO_PARTY"
   echo "Contract ID: $APP_INSTALL_CID"

.. cf-docs-snippet-cn-quickstart-json-api-verify-variables-end

Check that the token is valid
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

.. code-block:: bash
   :name: cf-docs-snippet-cn-quickstart-json-api-check-provider-token-valid-start

   curl -s "http://localhost:3975/v2/users/$APP_PROVIDER_USER_ID" \
     -H "Authorization: Bearer $PROVIDER_TOKEN" | jq .

.. cf-docs-snippet-cn-quickstart-json-api-check-provider-token-valid-end

A valid token shows the provider token meta data.

An invalid token may show "a security-sensitive error has been received"

.. code-block:: text
   :name: cf-docs-snippet-cn-quickstart-json-api-check-provider-token-invalid-start

   curl -s "http://localhost:3975/v2/users/$APP_PROVIDER_USER_ID" \
     -H "Authorization: Bearer $PROVIDER_TOKEN" | jq

.. cf-docs-snippet-cn-quickstart-json-api-check-provider-token-invalid-end

If needed, regenerate the session and then check that the token is valid, again.

.. code-block:: bash

   PROVIDER_TOKEN=$(curl -f -s -S "http://keycloak.localhost:8082/realms/AppProvider/protocol/openid-connect/token" \
     -H 'Content-Type: application/x-www-form-urlencoded' \
     -d 'client_id=app-provider-unsafe' \
     -d 'username=app-provider' \
     -d 'password=abc123' \
     -d 'grant_type=password' \
     -d 'scope=openid' | jq -r .access_token)

Exercise the CreateLicense choice
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

.. code-block:: bash
   :name: cf-docs-snippet-cn-quickstart-json-api-create-license-start

   LICENSE_UUID=$(uuidgen)
   JSON_PAYLOAD=$(cat <<EOF
   {
     "commands": [{
       "ExerciseCommand": {
         "templateId": "$PACKAGE_ID:Licensing.AppInstall:AppInstall",
         "contractId": "$APP_INSTALL_CID",
         "choice": "AppInstall_CreateLicense",
         "choiceArgument": {
           "uuid": "$LICENSE_UUID",
           "params": {
             "meta": {"values": {}}
           }
         }
       }
     }],
     "workflowId": "create-license",
     "applicationId": "app-provider-app",
     "commandId": "license-$(date +%s%N)",
     "actAs": ["$APP_PROVIDER_PARTY"],
     "readAs": [],
     "submissionId": "create-license",
     "disclosedContracts": [],
     "domainId": "",
     "packageIdSelectionPreference": []
   }
   EOF
   )
   
   curl -X POST "http://localhost:3975/v2/commands/submit-and-wait" \
     -H "Authorization: Bearer $PROVIDER_TOKEN" \
     -H "Content-Type: application/json" \
     -d "$JSON_PAYLOAD"

.. cf-docs-snippet-cn-quickstart-json-api-create-license-end

If you see an error "Contract could not be found with id then you have assigned an incorrect contract ID to a contractId variable.

.. code-block::
   :name: cf-docs-snippet-cn-quickstart-json-api-create-license-contract-not-found-start

   {"code":"CONTRACT_NOT_FOUND","cause":"Contract could not be found with id 0093e43a6fe746a56fb38e02f897194764150545917f127c6eb2c96b69976d83f6ca111220e6f80978587f7b7cd8ebbd8e176b2bb976fc3a6d3c6762d6fb8aad8e3c210b9f","correlationId":"create-license","traceId":"1e8a0ba16a95ef0881b1edb46b6f177a","context":{"participant":"'app-provider'","category":"11","tid":"1e8a0ba16a95ef0881b1edb46b6f177a","definite_answer":"false","commands":"{readAs: [], deduplicationPeriod: {duration: 'PT30S'}, submittedAt: '2025-10-28T16:20:38.735022Z', submissionId: 'create-license', actAs: ['app_provider_quickstart-jpmiller-1::1220349240f3f941ea497e05c40ae2497f1f2684706c0212e8cba854510332676ed6'], commandId: 'license-1761668438670963000', userId: '553c6754-8879-41c9-ae80-b302f5af92c9', workflowId: 'create-license'}"},"resources":[["ErrorResource(CID)","0093e43a6fe746a56fb38e02f897194764150545917f127c6eb2c96b69976d83f6ca111220e6f80978587f7b7cd8ebbd8e176b2bb976fc3a6d3c6762d6fb8aad8e3c210b9f"]],"errorCategory":11,"grpcCodeValue":5,"retryInfo":null,"definiteAnswer":null}%

.. cf-docs-snippet-cn-quickstart-json-api-create-license-contract-not-found-end

Success returns a new updateId and completionOffset.

.. code-block::
   :name: cf-docs-snippet-cn-quickstart-json-api-create-license-response-start

   {"updateId":"12209864eb06a5407b006e1ded12dbfa495bfedef74463a314000bbbd9e2e412d27e","completionOffset":2559}

.. cf-docs-snippet-cn-quickstart-json-api-create-license-response-end

See the AppInstall request in lnav
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

.. code-block:: bash
   :name: cf-docs-snippet-cn-quickstart-json-api-lnav-filter-app-install-start

   :filter-in appinstall

.. cf-docs-snippet-cn-quickstart-json-api-lnav-filter-app-install-end

Get the License contract ID in daml shell
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Return to ``daml shell`` to get the License contract ID.

.. code-block:: bash
   :name: cf-docs-snippet-cn-quickstart-json-api-daml-shell-active-license-start

   active quickstart-licensing:Licensing.License:License

.. cf-docs-snippet-cn-quickstart-json-api-daml-shell-active-license-end

Copy the complete contract ID and return to the previous working terminal.

.. code-block:: bash
   :name: cf-docs-snippet-cn-quickstart-json-api-daml-shell-contract-license-start

   contract ###...

.. cf-docs-snippet-cn-quickstart-json-api-daml-shell-contract-license-end

Save the license contract ID in a variable
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

.. code-block:: bash
   :name: cf-docs-snippet-cn-quickstart-json-api-save-license-cid-start

   LICENSE_CID="..."

.. cf-docs-snippet-cn-quickstart-json-api-save-license-cid-end

Generate a unique renewal request
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

.. code-block:: bash
   :name: cf-docs-snippet-cn-quickstart-json-api-generate-renewal-request-id-start

   REQUEST_ID=$(uuidgen)
   REQUESTED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
   SETTLE_BEFORE=$(date -u -v+90M +"%Y-%m-%dT%H:%M:%SZ")

.. cf-docs-snippet-cn-quickstart-json-api-generate-renewal-request-id-end

Set the license extension
~~~~~~~~~~~~~~~~~~~~~~~~~~

.. code-block:: bash
   :name: cf-docs-snippet-cn-quickstart-json-api-set-license-extension-start

   LICENSE_EXTENSION_DAYS=30
   LICENSE_EXTENSION_MICROSECONDS=$((LICENSE_EXTENSION_DAYS * 24 * 60 * 60 * 1000000))

.. cf-docs-snippet-cn-quickstart-json-api-set-license-extension-end

Create the license renewal request
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

If you receive a "security-sensitive error has been received" then renew the token as before.

As a sanity check you may preemptively renew the token.

.. code-block:: bash

   PROVIDER_TOKEN=$(curl -f -s -S "http://keycloak.localhost:8082/realms/AppProvider/protocol/openid-connect/token" \
     -H 'Content-Type: application/x-www-form-urlencoded' \
     -d 'client_id=app-provider-unsafe' \
     -d 'username=app-provider' \
     -d 'password=abc123' \
     -d 'grant_type=password' \
     -d 'scope=openid' | jq -r .access_token)

Set the COMMAND_ID variable
~~~~~~~~~~~~~~~~~~~~~~~~~~~

.. code-block:: bash
   :name: cf-docs-snippet-cn-quickstart-json-api-set-command-id-start

   COMMAND_ID="complete-$(date +%s%N)"

.. cf-docs-snippet-cn-quickstart-json-api-set-command-id-end

The provider must complete the renewal before the settlement deadline, set here to 90 minutes after the request.

.. code-block:: bash
   :name: cf-docs-snippet-cn-quickstart-json-api-request-license-renewal-start

   JSON_PAYLOAD=$(cat <<EOF
   {
     "commands": [{
       "ExerciseCommand": {
         "templateId": "$PACKAGE_ID:Licensing.License:License",
         "contractId": "$LICENSE_CID",
         "choice": "License_Renew",
         "choiceArgument": {
           "requestId": "$REQUEST_ID",
           "licenseFeeInstrumentId": {
             "admin": "$DSO_PARTY",
             "id": "Amulet"
           },
           "licenseFeeAmount": "100.0",
           "licenseExtensionDuration": {
             "microseconds": $LICENSE_EXTENSION_MICROSECONDS
           },
           "requestedAt": "$REQUESTED_AT",
           "settleBefore": "$SETTLE_BEFORE",
           "description": "License renewal payment"
         }
       }
     }],
     "workflowId": "renew-license",
     "applicationId": "app-provider-app",
     "commandId": "$COMMAND_ID",
     "actAs": ["$APP_PROVIDER_PARTY"],
     "readAs": [],
     "submissionId": "renew-license",
     "disclosedContracts": [],
     "domainId": "",
     "packageIdSelectionPreference": []
   }
   EOF
   )
   
   curl -X POST "http://localhost:3975/v2/commands/submit-and-wait" \
     -H "Authorization: Bearer $PROVIDER_TOKEN" \
     -H "Content-Type: application/json" \
     -d "$JSON_PAYLOAD"

.. cf-docs-snippet-cn-quickstart-json-api-request-license-renewal-end

Success looks like:

.. code-block:: json
   :name: cf-docs-snippet-cn-quickstart-json-api-request-license-renewal-response-start

   {"updateId":"122067883fdbb23d7395fabab7fc44703b3d588e44924fe1d33b45eebc116ecd94a5","completionOffset":220}

.. cf-docs-snippet-cn-quickstart-json-api-request-license-renewal-response-end

LicenseRenewalRequest
~~~~~~~~~~~~~~~~~~~~~

In the provider's ``daml shell``, list the active renewal requests.

.. code-block:: bash
   :name: cf-docs-snippet-cn-quickstart-json-api-daml-shell-active-renewal-request-start

   active quickstart-licensing:Licensing.License:LicenseRenewalRequest

.. cf-docs-snippet-cn-quickstart-json-api-daml-shell-active-renewal-request-end

Run ``contract <contract-id>`` to inspect the payload. Match ``requestId`` to
``$REQUEST_ID`` and note the request's ``settlementReference``. This reference
identifies the payment for this renewal even if another request uses the same
``requestId``.

Fund the renewal in the Canton Wallet
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The ``LicenseRenewalRequest`` implements the Token Standard V2
``AllocationRequest`` interface. The user needs 100 Amulet available to fund the
fee. To inspect holdings in ``daml shell``, enable the AppUser PQS and run
``SHELL_DB=pqs-app-user make shell`` from the Quickstart directory, then query
the V2 holding interface. Exit the provider shell before opening the user shell.
You can also check the available balance in the wallet.

.. code-block:: bash
   :name: cf-docs-snippet-cn-quickstart-json-api-daml-shell-active-holdings-start

   active splice-api-token-holding-v2:Splice.Api.Token.HoldingV2:Holding

.. cf-docs-snippet-cn-quickstart-json-api-daml-shell-active-holdings-end

If the user's available balance is too low, use **Tap** in the LocalNet wallet
to add funds. If a recent holding or request is missing from ``daml shell``,
allow time for PQS to index the transaction and run the query again.

Open the Canton Wallet at http://wallet.localhost:2000/allocations and sign in
as ``app-user`` with password ``abc123``. Find the V2 allocation request with
your request ID, check the 100 Amulet fee and the provider, and click **Accept**.
The wallet uses the terms and metadata published by the request. When the
funding succeeds, the wallet shows **Withdraw**. The funds are reserved until
the provider completes the renewal.

Look up the active request and funded allocation
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Run the active renewal request query again in the provider's ``daml shell``.
If you switched to the AppUser shell, exit it and run ``make shell`` to return
to the provider's PQS.
Use the active contract with the ``settlementReference`` you noted. If the
``AllocationRequest_Accept`` choice was exercised on the request, it replaced
the contract and preserved that reference. Save the current contract ID.

.. code-block:: bash
   :name: cf-docs-snippet-cn-quickstart-json-api-save-renewal-request-cid-start

   RENEWAL_REQ_CID="###"

.. cf-docs-snippet-cn-quickstart-json-api-save-renewal-request-cid-end

Query for the funded allocation in the same shell.

.. code-block:: bash
   :name: cf-docs-snippet-cn-quickstart-json-api-daml-shell-active-allocations-start

   active splice-api-token-allocation-v2:Splice.Api.Token.AllocationV2:Allocation

.. cf-docs-snippet-cn-quickstart-json-api-daml-shell-active-allocations-end

Inspect the allocation with ``contract <contract-id>``. Its ``settlement.id``
matches ``$REQUEST_ID`` and its ``settlement.cid`` matches the request's
``settlementReference``. Check that ``allocation.authorizer.owner`` is the user
and that the sender leg in ``allocation.transferLegSides`` names the provider
as the recipient of 100 Amulet.

Save that allocation's contract ID and check the three IDs before completing
the renewal.

.. code-block:: bash
   :name: cf-docs-snippet-cn-quickstart-json-api-verify-renewal-variables-start

   ALLOCATION_CID="###"
   echo "Renewal Request: $RENEWAL_REQ_CID"
   echo "Allocation: $ALLOCATION_CID"
   echo "License: $LICENSE_CID"

.. cf-docs-snippet-cn-quickstart-json-api-verify-renewal-variables-end

Authenticate to the Quickstart backend
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Sign in as **AppProvider** at http://app-provider.localhost:3000/login.
The Quickstart backend requires a session and a CSRF token for this write.
In the browser's developer tools, open the cookies for
``http://app-provider.localhost:3000`` and copy the values for
``JSESSIONID`` and ``XSRF-TOKEN``. Enter them when prompted below.

.. code-block:: bash

   read -r -s -p 'JSESSIONID: ' PROVIDER_SESSION
   echo
   read -r -s -p 'XSRF-TOKEN: ' PROVIDER_CSRF
   echo

Generate a unique command ID
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

.. code-block:: bash
   :name: cf-docs-snippet-cn-quickstart-json-api-generate-complete-renewal-command-id-start

   COMMAND_ID="complete-renewal-$(uuidgen)"

.. cf-docs-snippet-cn-quickstart-json-api-generate-complete-renewal-command-id-end

Set the endpoint path to connect to the backend service to complete the license renewal
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Complete the renewal before the request's ``settleBefore`` deadline.
The backend asks Scan for the V2 factory contexts and disclosed contracts
needed to receive and settle the payment. It submits one ledger command that
pays the provider and replaces the license.

.. code-block:: bash
   :name: cf-docs-snippet-cn-quickstart-json-api-set-complete-renewal-endpoint-start

   ENDPOINT="http://app-provider.localhost:3000/api/licenses/${LICENSE_CID}:complete-renewal"

.. cf-docs-snippet-cn-quickstart-json-api-set-complete-renewal-endpoint-end

Create a variable for the request body
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

.. code-block:: bash
   :name: cf-docs-snippet-cn-quickstart-json-api-set-complete-renewal-request-body-start

   REQUEST_BODY=$(cat <<EOF
   {
     "renewalRequestContractId": "$RENEWAL_REQ_CID",
     "allocationContractId": "$ALLOCATION_CID"
   }
   EOF
   )

.. cf-docs-snippet-cn-quickstart-json-api-set-complete-renewal-request-body-end

Make the request to complete the license renewal
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

.. code-block:: bash
   :name: cf-docs-snippet-cn-quickstart-json-api-complete-license-renewal-start

   RESPONSE=$(curl -fsS -X POST "$ENDPOINT?commandId=$COMMAND_ID" \
     --cookie "JSESSIONID=$PROVIDER_SESSION; XSRF-TOKEN=$PROVIDER_CSRF" \
     -H "X-XSRF-TOKEN: $PROVIDER_CSRF" \
     -H "Content-Type: application/json" \
     -d "$REQUEST_BODY") && printf '%s\n' "$RESPONSE" | jq .

.. cf-docs-snippet-cn-quickstart-json-api-complete-license-renewal-end

Success ends in a ``licenseId``

.. code-block::
   :name: cf-docs-snippet-cn-quickstart-json-api-complete-license-renewal-response-start

   {
     "licenseId": "###"
   }

.. cf-docs-snippet-cn-quickstart-json-api-complete-license-renewal-response-end

After successful execution, return to daml shell and run a contract command using the new ``licenseId`` that was just returned to you.

.. code-block:: bash

   contract ###...
   
The replacement license has the same ``uuid`` as the original. Its
``expiresAt`` is extended by 30 days from the later of the original expiration
and the settlement time. The renewal request is no longer active.

Appendix
--------

User token and IDs cookbook
~~~~~~~~~~~~~~~~~~~~~~~~~~~

.. code-block:: bash
   :name: cf-docs-snippet-cn-quickstart-json-api-user-token-and-ids-cookbook-start

   #!/bin/bash
   # Complete LocalNet Setup Script
   
   
   # 1. Get Admin Tokens (for querying users)
   USER_ADMIN_TOKEN=$(curl -fsS "http://keycloak.localhost:8082/realms/AppUser/protocol/openid-connect/token" \
     -H 'Content-Type: application/x-www-form-urlencoded' \
     -d 'client_id=app-user-validator' \
     -d 'client_secret=6m12QyyGl81d9nABWQXMycZdXho6ejEX' \
     -d 'grant_type=client_credentials' \
     -d 'scope=openid' | jq -r .access_token)
   
   
   PROVIDER_ADMIN_TOKEN=$(curl -fsS "http://keycloak.localhost:8082/realms/AppProvider/protocol/openid-connect/token" \
     -H 'Content-Type: application/x-www-form-urlencoded' \
     -d 'client_id=app-provider-validator' \
     -d 'client_secret=AL8648b9SfdTFImq7FV56Vd0KHifHBuC' \
     -d 'grant_type=client_credentials' \
     -d 'scope=openid' | jq -r .access_token)
   
   
   # 2. Discover User IDs and Party IDs
   APP_USER_USER_ID=$(curl -s "http://localhost:2975/v2/users" \
     -H "Authorization: Bearer $USER_ADMIN_TOKEN" | \
     jq -r '.users[] | select(.metadata.annotations.username == "app-user") | .id')
   
   
   APP_USER_PARTY=$(curl -s "http://localhost:2975/v2/users/$APP_USER_USER_ID" \
     -H "Authorization: Bearer $USER_ADMIN_TOKEN" | jq -r '.user.primaryParty')
   
   
   APP_PROVIDER_USER_ID=$(curl -s "http://localhost:3975/v2/users" \
     -H "Authorization: Bearer $PROVIDER_ADMIN_TOKEN" | \
     jq -r '.users[] | select(.metadata.annotations.username == "app-provider") | .id')
   
   
   APP_PROVIDER_PARTY=$(curl -s "http://localhost:3975/v2/users/$APP_PROVIDER_USER_ID" \
     -H "Authorization: Bearer $PROVIDER_ADMIN_TOKEN" | jq -r '.user.primaryParty')
   
   
   # 3. Get User Tokens (for party operations)
   USER_TOKEN=$(curl -f -s -S "http://keycloak.localhost:8082/realms/AppUser/protocol/openid-connect/token" \
     -H 'Content-Type: application/x-www-form-urlencoded' \
     -d 'client_id=app-user-unsafe' \
     -d 'username=app-user' \
     -d 'password=abc123' \
     -d 'grant_type=password' \
     -d 'scope=openid' | jq -r .access_token)
   
   
   PROVIDER_TOKEN=$(curl -f -s -S "http://keycloak.localhost:8082/realms/AppProvider/protocol/openid-connect/token" \
     -H 'Content-Type: application/x-www-form-urlencoded' \
     -d 'client_id=app-provider-unsafe' \
     -d 'username=app-provider' \
     -d 'password=abc123' \
     -d 'grant_type=password' \
     -d 'scope=openid' | jq -r .access_token)
   
   
   # 4. Get Package ID
   PACKAGE_ID=$(dpm damlc inspect-dar daml/licensing/.daml/dist/quickstart-licensing-0.0.1.dar | \
     grep "quickstart-licensing-0.0.1-" | grep -v "dalf" | tail -1 | awk '{print $2}' | tr -d '"')
   
   
   # 5. Display all variables
   echo "=== Setup Complete ==="
   echo "APP_USER_USER_ID: $APP_USER_USER_ID"
   echo "APP_USER_PARTY: $APP_USER_PARTY"
   echo "APP_PROVIDER_USER_ID: $APP_PROVIDER_USER_ID"
   echo "APP_PROVIDER_PARTY: $APP_PROVIDER_PARTY"
   echo "PACKAGE_ID: $PACKAGE_ID"
   echo ""
   echo "Tokens set (first 50 chars):"
   echo "USER_TOKEN: ${USER_TOKEN:0:50}..."
   echo "PROVIDER_TOKEN: ${PROVIDER_TOKEN:0:50}..."
   
   
   # Check if the user exists on the participant
   curl "http://localhost:2975/v2/users/92a520cb-2f09-4e55-b465-d178c6cfe5e4" \
     -H "Authorization: Bearer $USER_ADMIN_TOKEN"

.. cf-docs-snippet-cn-quickstart-json-api-user-token-and-ids-cookbook-end

Additional ports the default setup exposes
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

**Ledger API ports**
(2901, 3901, 4901): Canton Ledger API access

**Admin API ports**
(2902, 3902, 4902): system administration

Health checks
~~~~~~~~~~~~~

You can find the health check endpoints for each validator in ``quickstart/docker/modules/localnet/docker/splice/health-check.sh``.

Empty responses indicate healthy services.

.. code-block:: bash

   curl -f http://localhost:2903/api/validator/readyz  # App User
   curl -f http://localhost:3903/api/validator/readyz  # App Provider 
   curl -f http://localhost:4903/api/validator/readyz  # Super Validator

Access admin ports
~~~~~~~~~~~~~~~~~~

Admin ports are defined in ``quickstart/docker/modules/localnet/compose.yaml``

.. code-block:: bash
   :name: cf-docs-snippet-cn-quickstart-json-api-access-admin-ports-start

   curl -v http://localhost:2902/admin    # Would access App User admin if exposed
   curl -v http://localhost:3902/admin    # Would access App Provider admin if exposed

.. cf-docs-snippet-cn-quickstart-json-api-access-admin-ports-end

Show the Daml ledger API claims in your token
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

.. code-block:: bash
   :name: cf-docs-snippet-cn-quickstart-json-api-show-token-ledger-api-claims-start

   echo $USER_TOKEN | cut -d. -f2 | base64 -d 2>/dev/null | jq '."https://daml.com/ledger-api"'

.. cf-docs-snippet-cn-quickstart-json-api-show-token-ledger-api-claims-end


How to discover the user and provider IDs
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

AppUser and AppProvider validator, wallet admin, and other IDs are located in their respective oauth2.env files.

.. code-block:: bash
   :name: cf-docs-snippet-cn-quickstart-json-api-discover-ids-admin-token-start

   # 1. Get admin token for the participant
   USER_ADMIN_TOKEN=$(curl -fsS "http://keycloak.localhost:8082/realms/AppUser/protocol/openid-connect/token" \
     -H 'Content-Type: application/x-www-form-urlencoded' \
     -d 'client_id=app-user-validator' \
     -d 'client_secret=6m12QyyGl81d9nABWQXMycZdXho6ejEX' \
     -d 'grant_type=client_credentials' \
     -d 'scope=openid' | jq -r .access_token)

.. cf-docs-snippet-cn-quickstart-json-api-discover-ids-admin-token-end

.. code-block:: bash
   :name: cf-docs-snippet-cn-quickstart-json-api-discover-ids-list-users-start

   # 2. List all users to discover the wallet admin user
   curl -s "http://localhost:2975/v2/users" \
     -H "Authorization: Bearer $USER_ADMIN_TOKEN" | jq '.users[] | select(.metadata.annotations.username == "app-user")'

.. cf-docs-snippet-cn-quickstart-json-api-discover-ids-list-users-end

.. code-block:: bash
   :name: cf-docs-snippet-cn-quickstart-json-api-discover-ids-extract-user-id-start

   # 3. Extract the user ID from the result
   APP_USER_ID=$(curl -s "http://localhost:2975/v2/users" \
     -H "Authorization: Bearer $USER_ADMIN_TOKEN" | jq -r '.users[] | select(.metadata.annotations.username == "app-user") | .id')

.. cf-docs-snippet-cn-quickstart-json-api-discover-ids-extract-user-id-end

.. code-block:: bash
   :name: cf-docs-snippet-cn-quickstart-json-api-discover-ids-get-party-start

   # 4. Get the party ID for that user
   APP_USER_PARTY=$(curl -s "http://localhost:2975/v2/users/$APP_USER_ID" \
     -H "Authorization: Bearer $USER_ADMIN_TOKEN" | jq -r '.user.primaryParty')

.. cf-docs-snippet-cn-quickstart-json-api-discover-ids-get-party-end
