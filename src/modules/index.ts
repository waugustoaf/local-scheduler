import { Registry } from "../core/registry.ts";
import { sqlModule } from "./sql/index.ts";
import { scriptModule } from "./scripts/index.ts";
export function modules() {
  return new Registry().register(sqlModule).register(scriptModule);
}
