import { expect, type Locator, type Page } from '@playwright/test';
import RowOps from '../../utils/rowOps';

const APP_PROVIDER_APP_INSTALLS_URL = 'http://app-provider.localhost:3000/app-installs';

export enum Status {
  Requested = 'Requested',
  Installed = 'Installed',
}

export enum Button {
  Accept = 'Accept',
  CancelInstallation = 'Cancel installation',
  CreateLicense = 'Create license',
  Reject = 'Reject',
}

export default class AppInstalls extends RowOps {
  constructor(page: Page) {
    super(page);
  }

  /** The panel that shows the selected item's status and actions. */
  private detail = (): Locator => this.page.getByRole('region', { name: 'Installation details' });

  /** Installation items are list items. Each shows its request metadata, which holds the test tag. */
  override findRowBy = (pattern: string | RegExp): Locator => {
    return this.page.getByRole('listitem').filter({ hasText: pattern });
  };

  /** Selects the matching item, so that the detail panel shows it. */
  override async withRowMatching(
    pattern: string | RegExp,
    withRow: (row: Locator) => Promise<void>,
  ): Promise<void> {
    await super.withRowMatching(pattern, async (row) => {
      await row.getByRole('button').click();
      await withRow(row);
    });
  }

  public async goto(): Promise<void> {
    await this.page.goto(APP_PROVIDER_APP_INSTALLS_URL);
  }

  public async assertStatus(status: Status): Promise<void> {
    await expect(this.detail().getByText(status, { exact: true })).toBeVisible();
  }

  public async clickButton(button: Button): Promise<void> {
    await this.detail().getByRole('button', { name: button }).click();
  }

  public async assertLicenseCountIs(licenseCount: number): Promise<void> {
    await expect(
      this.detail().getByTestId('num-licenses'),
      `There should be ${licenseCount} license(s) for the AppInstall`,
    ).toHaveText(licenseCount.toString());
  }

  public async captureLicenseId(): Promise<string> {
    // wait for the success message to appear
    const success = this.page.getByText(/Success: Created License:/);
    await expect(success).toBeVisible();

    // read its textContent
    const fullText = await success.textContent();
    // e.g. "Success: Created License: 00a6f3cf…"

    // extract just the ID
    const match = fullText?.match(/Success: Created License: ([0-9a-f]+)/);
    const licenseId = match?.[1];
    expect(licenseId, 'license ID should parse').toBeTruthy();
    if (!licenseId) {
      throw new Error('license ID should parse');
    }
    console.log('Captured new LicenseId:', licenseId);

    await this.page.getByRole('button', { name: 'Close' }).click();

    return licenseId;
  }
}
