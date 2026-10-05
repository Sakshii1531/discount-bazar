/** API E2E matrix — admin panel (see matrix/admin.cases.js). */
import cases, { seed } from "./matrix/admin.cases.js";
import { matrixSuite } from "./helpers/matrixSuite.js";

matrixSuite("admin API", cases, { seed });
