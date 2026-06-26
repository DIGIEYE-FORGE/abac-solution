import type { AuditEntryMessage, ServiceIdentity, ValidatedAuditEntry } from "./events.types";
import { eventsRepository } from "./events.repository";
import { validateAuditEntry } from "./events.validation";

export class EventsService {
  validate(entry: AuditEntryMessage, identity: ServiceIdentity): ValidatedAuditEntry {
    return validateAuditEntry(entry, identity);
  }

  async insertBatch(entries: ValidatedAuditEntry[]): Promise<void> {
    await eventsRepository.insertBatch(entries);
  }
}

export const eventsService = new EventsService();
