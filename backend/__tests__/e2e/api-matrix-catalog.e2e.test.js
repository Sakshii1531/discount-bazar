/** API E2E matrix — catalogue & marketing (see matrix/catalog.cases.js). */
import cases from "./matrix/catalog.cases.js";
import { matrixSuite } from "./helpers/matrixSuite.js";

matrixSuite("catalogue & marketing API", cases);
