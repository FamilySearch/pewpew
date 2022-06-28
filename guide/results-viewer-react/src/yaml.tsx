import * as React from "react";
import { YamlWriter } from "./YamlWriter";
import { createRoot } from "react-dom/client";

const root = createRoot(document.getElementById("root")!);
root.render(<YamlWriter />);