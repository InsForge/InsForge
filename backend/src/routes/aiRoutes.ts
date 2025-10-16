import { Router } from "express";
import { aiGenerateSchema } from "../controllers/aiSchemaController";

const router = Router();

router.post("/generate-schema", aiGenerateSchema);

export default router;
