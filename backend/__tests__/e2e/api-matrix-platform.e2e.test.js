/** API E2E matrix — platform endpoints (see matrix/platform.cases.js). */
import cases from "./matrix/platform.cases.js";
import { matrixSuite } from "./helpers/matrixSuite.js";

matrixSuite("platform API", cases);
