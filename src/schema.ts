import type { PlatformSchema } from "./types.ts";
import devpostJson from "../schemas/schema_devpost.json" with { type: "json" };
import appsumoJson from "../schemas/schema_appsumo.json" with { type: "json" };

export const devpostSchema = devpostJson as PlatformSchema;
export const appsumoSchema = appsumoJson as PlatformSchema;
