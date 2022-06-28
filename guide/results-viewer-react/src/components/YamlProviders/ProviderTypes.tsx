import { PewPewProvider, ProviderListEntry } from "../../util/yamlwriter";
import FileProvider from "./File";
import ListProvider from "./List";
import RangeProvider from "./Range";
import React from "react";
import ResponseProvider from "./Response";

export interface ProviderTypesProps {
  deleteProvider: (id: string) => void;
  changeProvider: (pewpewProvider: PewPewProvider) => void;
  data: PewPewProvider;
}

export interface ProviderProps {
  deleteProvider: (id: string) => void;
  changeProvider: (pewpewProvider: PewPewProvider) => void;
  data: PewPewListProvider | PewPewRangeProvider | PewPewResponseProvider | PewPewFileProvider;
}

export interface PewPewListProvider extends PewPewProvider {
  list: ProviderListEntry[];
}

export interface PewPewRangeProvider extends PewPewProvider {
  start: number;
  end: number | string;
  step: number | string;
}

export interface PewPewResponseProvider extends PewPewProvider {
  response: Record<string, string>;
}

export interface PewPewFileProvider extends PewPewProvider {
  file: string;
}

export function ProviderTypes ({deleteProvider: deleteSelf, changeProvider, data}: ProviderTypesProps) {
  return (
  <div>
    {(data.type === "file") &&
      <FileProvider data={data as PewPewFileProvider} deleteProvider={deleteSelf} changeProvider={changeProvider} /> }
    {(data.type === "response") &&
      <ResponseProvider data={data as PewPewResponseProvider} deleteProvider={deleteSelf} changeProvider={changeProvider}/>}
    {(data.type === "range") &&
      <RangeProvider data={data as PewPewRangeProvider} deleteProvider={deleteSelf} changeProvider={changeProvider}/>}
    {(data.type === "list") &&
      <ListProvider data={data as PewPewListProvider} deleteProvider={deleteSelf} changeProvider={changeProvider}/>}
  </div>
  );
}

export enum ProviderType  {
  "file" = "file",
  "response" = "response",
  "range" = "range",
  "list" = "list"
}
export type PewPewProvidersStringType = "name" | "file";
export type PewPewProvidersNumberType = "start" | "end" | "step";
export type PewPewProvidersBooleanType = "repeat" | "random";
