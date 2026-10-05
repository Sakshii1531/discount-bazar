/** API E2E matrix — delivery partner (see matrix/delivery.cases.js). */
import cases from "./matrix/delivery.cases.js";
import { matrixSuite } from "./helpers/matrixSuite.js";

matrixSuite("delivery API", cases);
