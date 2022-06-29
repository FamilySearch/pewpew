import { DisplayDivBody, DisplayDivMain } from "../YamlWriterForm";
import Providers, {ProviderMainProps} from ".";
import { GlobalStyle } from "../Global";
import { PewPewProvider } from "../../util/yamlwriter";
import React from "react";
import { storiesOf } from "@storybook/react";

const props: ProviderMainProps = {
  addProvider: (pewpewProvider: PewPewProvider) => {
    // eslint-disable-next-line no-console
    console.log("Adding provider", pewpewProvider);
  },
  clearAllProviders: () => {
    // eslint-disable-next-line no-console
    console.log("Removing all providers");
  },
  deleteProvider: (id: string) => {
    // eslint-disable-next-line no-console
    console.log("deleting provider " + id);
  },
  changeProvider: (pewpewProvider: PewPewProvider) => {
    // eslint-disable-next-line no-console
    console.log("changing provider " + pewpewProvider.id, pewpewProvider);
  },
  providers: []
};

const propsEmpty: ProviderMainProps = { ...props,
  providers: []
};

const propsLoaded: ProviderMainProps = { ...props,
  providers: [
    { id: "0", type: "file", name: "cisids", file: "cisids.csv", repeat: true, random: false },
    { id: "1", type: "response", name: "sessionId", response: {} },
    { id: "2", type: "range", name: "length", start: 0, end: "", step: "", repeat: false },
    { id: "3", type: "list", name: "urls",
      list: [{ id: "0", value: "element 0" }, { id: "1", value: "element 1" }, { id: "2", value: "element 2" }, { id: "3", value: "element 3" }],
      repeat: true, random: false
    }
  ]
};

storiesOf("YamlProviders", module).add("Default", () => (
  <React.Fragment>
    <GlobalStyle />
    <DisplayDivMain>
      <DisplayDivBody>
        <Providers {...propsEmpty} ></Providers>
      </DisplayDivBody>
    </DisplayDivMain>
  </React.Fragment>
));

storiesOf("YamlProviders", module).add("Loaded", () => (
  <React.Fragment>
    <GlobalStyle />
    <DisplayDivMain>
      <DisplayDivBody>
        <Providers {...propsLoaded} ></Providers>
      </DisplayDivBody>
    </DisplayDivMain>
  </React.Fragment>
));
