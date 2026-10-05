/** API E2E matrix — returns & feedback (see matrix/returns-feedback.cases.js). */
import cases, { seed } from "./matrix/returns-feedback.cases.js";
import { matrixSuite } from "./helpers/matrixSuite.js";

matrixSuite("returns & feedback API", cases, { seed });
