import type { Request, Response } from "express";
import { searchService } from "./search.service";

function param(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] : value ?? "";
}

export class SearchController {
  async search(req: Request, res: Response) {
    res.json(await searchService.search(req.query));
  }

  async findById(req: Request, res: Response) {
    res.json(await searchService.findById(param(req.params.id)));
  }

  async findByRequestId(req: Request, res: Response) {
    res.json(await searchService.findByRequestId(param(req.params.requestId)));
  }

  async findByUserId(req: Request, res: Response) {
    res.json(await searchService.findByUserId(param(req.params.userId)));
  }

  async findByResource(req: Request, res: Response) {
    res.json(await searchService.findByResource(param(req.params.resource), param(req.params.resourceId)));
  }
}

export const searchController = new SearchController();