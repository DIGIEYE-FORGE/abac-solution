import { Router, type NextFunction, type Request, type Response } from "express";
import { searchController } from "./search.controller";

const router = Router();

function asyncRoute(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, next).catch(next);
  };
}

router.get("/", asyncRoute((req, res) => searchController.search(req, res)));
router.get("/by-request/:requestId", asyncRoute((req, res) => searchController.findByRequestId(req, res)));
router.get("/by-user/:userId", asyncRoute((req, res) => searchController.findByUserId(req, res)));
router.get("/by-resource/:resource/:resourceId", asyncRoute((req, res) => searchController.findByResource(req, res)));
router.get("/:id", asyncRoute((req, res) => searchController.findById(req, res)));

export default router;
