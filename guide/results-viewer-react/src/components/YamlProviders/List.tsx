import { Button, Div, Input, Label, Span } from "../YamlStyles";
import { Modal, ModalObject, useEffectModal } from "../Modal";
import { PewPewListProvider, PewPewProvidersBooleanType, PewPewProvidersStringType, ProviderProps } from "./ProviderTypes";
import React, { useRef, useState } from "react";
import { DeleteIcon } from "../Icons/DeleteIcon";
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
        <Input type="text" style={{width: "130px"}} onChange={(event) => changeProvider("name", event.target.value)} name={data.id} value={data.name} />
      </Span>
      <Span>
        <Label> List: </Label>
        <QuestionBubble text="Values to be included in list"></QuestionBubble>
          <Button onClick={() => modalRef.current?.openModal()}>
            Edit List
          </Button>
      </Span>
        <Modal
        ref={modalRef}
        title="Edit List"
        closeText="Close"
        >
        <div style={{ display: "flex" }}>
          Add values to your List provider&nbsp;&nbsp;
            <Input id="providerList" name={data.id} value={state.value} onChange={handleChangeModalValue} onKeyUp={onKeyUp}/>
            <Button id="providerList" name={data.id} value={state.value} onClick={addListItem} style={{ marginLeft: "5px" }} >
                Add
            </Button>
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
                  <td className="tableButton"><Button id="providerList" name={data.id} value={item.id} onClick={deleteListItem}><DeleteIcon /></Button></td>
                  <td className="tableListItem">{item.value}</td>
                </tr>);
            })}
          </tbody>
        </table>
        </Modal>
      <Span>
          <Label> Repeat </Label>
          <QuestionBubble text="Optional | Want random to be true"></QuestionBubble>
          <Input style={{marginRight: "15px"}} type="checkbox" name={data.id} onChange={(event) => handleClick("repeat", event.target.checked)} checked={data.repeat}/>
      </Span>
      <Span>
          <Label> Random </Label>
          <QuestionBubble text="Optional | Want random to be true"></QuestionBubble>
          <Input style={{marginRight: "15px"}} type="checkbox" name={data.id} onChange={(event) => handleClick("random", event.target.checked)} checked={data.random}/>
      </Span>
      <Button style={{marginLeft: "auto"}} id={data.id} onClick={deleteProvider}><DeleteIcon /></Button>
    </Div>
  );
}

export default ListProvider;
