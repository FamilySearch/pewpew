import { Label, TipButton } from "../YamlStyles";
import React, { type JSX } from "react";
import { AddIcon } from "../Icons/AddIcon";
import { DeleteIcon } from "../Icons/DeleteIcon";
import { Row } from "../Div";

interface ToggleDefaultsProps {
    title: string;
    handleAddMissing: () => void;
    handleDeleteAll: () => void;
    addDisabled?: boolean;
    deleteDisabled?: boolean;
}

const ToggleDefaults = ({ title, handleAddMissing, handleDeleteAll, addDisabled, deleteDisabled }: ToggleDefaultsProps): JSX.Element => {
    return (
        <Row>
            <Label>Default {title}:</Label>
            <TipButton onClick={handleAddMissing} disabled={addDisabled}>
                <AddIcon />
                <span>Add Missing</span>
            </TipButton>
            <TipButton onClick={handleDeleteAll} disabled={deleteDisabled}>
                <DeleteIcon />
                <span>Delete All</span>
            </TipButton>
        </Row>
    );
};

export default ToggleDefaults;