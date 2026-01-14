import * as React from "react";
import { YamlWriter } from "./YamlWriter";
import { createRoot } from "react-dom/client";

const root = createRoot(document.querySelector("#root") || document.querySelector("div")!);
root.render(<YamlWriter />);