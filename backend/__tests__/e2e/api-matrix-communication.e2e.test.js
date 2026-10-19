/** API E2E matrix — order communication endpoints (see matrix/communication.cases.js). */
import cases, { seed } from "./matrix/communication.cases.js";
import { matrixSuite } from "./helpers/matrixSuite.js";

matrixSuite("order communication API", cases, { seed });
