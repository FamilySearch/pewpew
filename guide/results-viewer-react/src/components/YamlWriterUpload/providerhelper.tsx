import { PewPewListProvider } from "../YamlProviders/ProviderTypes";
import { uniqueId } from "../../util/clientutil";
import { useState } from "react";
import { PewPewProvider } from "../../util/yamlwriter";


export const useProviderManager = () => {
    const [providers, setProviders] = useState<PewPewProvider[]>([]);


    const addProviders = (variables: Set<string>) => {
        const newListProviders = Array.from(variables).map(variable => ({
            id: uniqueId(),
            type: "list",
            name: variable,
            list: [],
            repeat: true,
            random: false
        }) as PewPewListProvider);
        setProviders((prevProviders) => [...prevProviders, ...newListProviders]);
        return newListProviders;
    };
    return { providers, addProviders };
};