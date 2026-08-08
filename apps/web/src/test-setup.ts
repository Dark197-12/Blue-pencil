import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

/**
 * Testing Library only unmounts automatically when Vitest's globals are on.
 * They are not, so without this each render stacks on the previous one and
 * queries match elements from earlier tests.
 */
afterEach(cleanup);
