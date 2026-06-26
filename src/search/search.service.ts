import { z } from "zod";
import { eventsRepository } from "../events/events.repository";
import type { LogsSearchQuery } from "../events/events.types";

const querySchema = z.object({
  tenantId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  platformId: z.string().uuid().optional(),
  service: z.string().trim().optional(),
  environment: z.string().trim().optional(),
  requestId: z.string().trim().optional(),
  traceId: z.string().trim().optional(),
  eventType: z.string().trim().optional(),
  resource: z.string().trim().optional(),
  resourceId: z.string().trim().optional(),
  action: z.string().trim().optional(),
  outcome: z.string().trim().optional(),
  statusCode: z.coerce.number().int().min(100).max(599).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  skip: z.coerce.number().int().min(0).default(0),
  sort: z.enum(["timestamp_asc", "timestamp_desc", "created_at_asc", "created_at_desc"]).optional(),
});

function toSearchQuery(raw: unknown): LogsSearchQuery {
  const parsed = querySchema.parse(raw);
  return {
    ...parsed,
    from: parsed.from ? new Date(parsed.from) : undefined,
    to: parsed.to ? new Date(parsed.to) : undefined,
  };
}

export class SearchService {
  async search(rawQuery: unknown) {
    return {
      results: await eventsRepository.search(toSearchQuery(rawQuery)),
    };
  }

  async findById(id: string) {
    const result = await eventsRepository.findById(id);
    if (!result) {
      throw Object.assign(new Error("Log not found"), { statusCode: 404 });
    }
    return result;
  }

  async findByRequestId(requestId: string) {
    return { results: await eventsRepository.findByRequestId(requestId) };
  }

  async findByUserId(userId: string) {
    z.string().uuid().parse(userId);
    return { results: await eventsRepository.findByUserId(userId) };
  }

  async findByResource(resource: string, resourceId: string) {
    return { results: await eventsRepository.findByResource(resource, resourceId) };
  }
}

export const searchService = new SearchService();
