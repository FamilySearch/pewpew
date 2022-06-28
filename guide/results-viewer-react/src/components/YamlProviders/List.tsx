import { Div, Label, Span } from "../YamlStyles";
import { Modal, ModalObject, useEffectModal } from "../Modal";
import { PewPewListProvider, PewPewProvidersBooleanType, PewPewProvidersStringType, ProviderProps } from "./ProviderTypes";
import React, { useRef, useState } from "react";
import { ProviderListEntry } from "../../util/yamlwriter";
import QuestionBubble from "../YamlQuestionBubble";
import { uniqueId } from "../../util/clientutil";

interface ListProviderProps extends ProviderProps {
  data: PewPewListProvider;
}

interface ListProviderState {
  value: string;
}

export function ListProvider ({ data, ...props }: ListProviderProps) {
  const defaultState: ListProviderState = {
    value: ""
  };

  const [state, setState] = useState(defaultState);
  const updateState = (newState: Partial<ListProviderState>) => setState((oldState): ListProviderState => ({ ...oldState, ...newState }));

  const modalRef = useRef<ModalObject| null>(null);
  useEffectModal(modalRef);

  const addListItem = () => {
    const list = [...data.list, { id: uniqueId(), value: (state.value) }];
    props.changeProvider({ ...data, list });
    updateState({ value: "" });
  };

  const handleChangeModalValue = (event: React.ChangeEvent<HTMLInputElement>) => {
    setState((prevState: ListProviderState) => ({...prevState, value: event.target.value}));
  };

  const deleteListItem = (event: React.MouseEvent<HTMLButtonElement>) => {
    const element = event.target as HTMLInputElement;
    const list = (data.list).filter((item: ProviderListEntry) => item.id !== element.value);
    props.changeProvider({ ...data, list });
  };

  const handleClick = (type: PewPewProvidersBooleanType, newChecked: boolean) => {
    props.changeProvider({ ...data, [type]: newChecked });
  };

  const onKeyUp = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      addListItem();
    }
  };

  const changeProvider = (type: PewPewProvidersStringType, value: string) => {
    props.changeProvider({ ...data, [type]: value });
  };

  const deleteProvider = () => {
    props.deleteProvider(data.id);
  };

  return (
    <Div>
      <Span>
        <Label> Name: </Label>
        <QuestionBubble text="Name of Provider"></QuestionBubble>
        <input type="text" style={{width: "130px"}} onChange={(event) => changeProvider("name", event.target.value)} name={data.id} value={data.name} />
      </Span>
      <Span>
        <Label> List: </Label>
        <QuestionBubble text="Values to be included in list"></QuestionBubble>
          <button onClick={() => modalRef.current?.openModal()}>
            Edit List
          </button>
      </Span>
        <Modal
        ref={modalRef}
        title="Edit List"
        closeText="Close"
        >
        <div>
          Add values to your List provider&nbsp;&nbsp;
            <input id="providerList" name={data.id} value={state.value} onChange={handleChangeModalValue} onKeyUp={onKeyUp}/>
            <button id="providerList" name={data.id} value={state.value} onClick={addListItem} >
                Add
            </button>
        </div>
        <table>
          <thead>
            <tr>
              <th></th>
              <th>List</th>
            </tr>
          </thead>
          <tbody>
            {(data.list).map((item: ProviderListEntry) => {
              return (
                <tr key={item.id}>
                  <td className="tableButton"><button id="providerList" name={data.id} value={item.id} onClick={deleteListItem}>X</button></td>
                  <td className="tableListItem">{item.value}</td>
                </tr>);
            })}
          </tbody>
        </table>
        </Modal>
      <Span>
          <Label> Repeat </Label>
          <QuestionBubble text="Optional | Want random to be true"></QuestionBubble>
          <input style={{marginRight: "15px"}} type="checkbox" name={data.id} onChange={(event) => handleClick("repeat", event.target.checked)} checked={data.repeat}/>
      </Span>
      <Span>
          <Label> Random </Label>
          <QuestionBubble text="Optional | Want random to be true"></QuestionBubble>
          <input style={{marginRight: "15px"}} type="checkbox" name={data.id} onChange={(event) => handleClick("random", event.target.checked)} checked={data.random}/>
      </Span>
      <button style={{marginLeft: "auto"}} id={data.id} onClick={deleteProvider}>X</button>
    </Div>
  );
}

export default ListProvider;
