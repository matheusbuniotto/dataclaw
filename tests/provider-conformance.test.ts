import { providerConformance } from "./fixtures/providers/conformance";
import { fakeHarness } from "./fixtures/providers/fake";

providerConformance("fake warehouse", async (scenario) =>
    fakeHarness(scenario, scenario === "no-describe" ? { tools: ["run_sql", "list_objects"] } : {}));
