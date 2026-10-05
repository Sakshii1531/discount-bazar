/** API E2E matrix — customer endpoints (see matrix/customer.cases.js). */
import cases from "./matrix/customer.cases.js";
import { matrixSuite } from "./helpers/matrixSuite.js";

matrixSuite("customer API", cases);
