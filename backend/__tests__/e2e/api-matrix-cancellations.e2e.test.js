/** API E2E matrix — order cancellations (see matrix/cancellations.cases.js). */
import cases, { seed } from "./matrix/cancellations.cases.js";
import { matrixSuite } from "./helpers/matrixSuite.js";

matrixSuite("cancellations API", cases, { seed });
