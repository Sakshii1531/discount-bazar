/** API E2E matrix — order life-cycle (see matrix/orders.cases.js). */
import cases from "./matrix/orders.cases.js";
import { matrixSuite } from "./helpers/matrixSuite.js";

matrixSuite("orders API", cases);
