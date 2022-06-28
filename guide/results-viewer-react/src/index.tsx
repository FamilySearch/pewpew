import * as React from "react";
import { ResultsViewer } from "./ResultsViewer";
import { createRoot } from "react-dom/client";

const root = createRoot(document.getElementById("root")!);
root.render(<ResultsViewer />);