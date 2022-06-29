export const isYamlFile = (filename: string) => filename.endsWith(".yaml") || filename.endsWith(".yml");

// Creates unique id for a specific react element
export const uniqueId = () => {
  const id: string =  "" + Date.now() + Math.random();
  return id;
};
