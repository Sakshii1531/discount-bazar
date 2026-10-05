/** API E2E matrix — seller panel (see matrix/seller.cases.js). */
import cases from "./matrix/seller.cases.js";
import { matrixSuite } from "./helpers/matrixSuite.js";

matrixSuite("seller API", cases);
