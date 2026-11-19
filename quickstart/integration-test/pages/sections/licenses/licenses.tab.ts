import { expect, type Locator, type Page } from '@playwright/test';
import RowOps from '../../../utils/rowOps';
import ArchiveModal from './archive.modal';
import RenewalsModal from './renewals/renewals.modal';

const APP_PROVIDER_LICENSES_URL = 'http://app-provider.localhost:3000/licenses';

type LicenseSnapshot = {
  contractId: string;
  uuid: string;
  expiresAt: string;
  renewalRequests: { requestId: string }[];
};

export enum Button {
  Renewals = 'Renewals',
  Archive = 'Archive',
}

export default class Licenses extends RowOps {
  archiveModal: ArchiveModal;
  renewalsModal: RenewalsModal;

  constructor(page: Page) {
    super(page);
    this.archiveModal = new ArchiveModal(page);
    this.renewalsModal = new RenewalsModal(page);
  }

  button = (name: string, row: Locator = this.matchingRow): Locator => {
    return row.getByRole('button', { name: name });
  };

  public async assertButtonExists(button: Button, row: Locator = this.matchingRow): Promise<void> {
    await expect(this.button(button, row)).toBeVisible();
  }

  public async clickButton(button: Button, row: Locator = this.matchingRow): Promise<void> {
    await this.button(button, row).click();
  }

  public async goto(): Promise<void> {
    await this.page.goto(APP_PROVIDER_LICENSES_URL);
  }

  public async list(): Promise<LicenseSnapshot[]> {
    return this.page.evaluate(async () => {
      const response = await fetch('/api/licenses');
      if (!response.ok) throw new Error(`Listing licenses returned HTTP ${response.status}`);
      return response.json();
    });
  }

  public async waitForURL(url: string | RegExp): Promise<void> {
    await this.page.waitForURL(url);
  }
}
