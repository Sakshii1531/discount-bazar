/** API E2E matrix — payments (see matrix/payments.cases.js). */
import cases, { seed } from "./matrix/payments.cases.js";
import { matrixSuite } from "./helpers/matrixSuite.js";

matrixSuite("payments API", cases, { seed });
