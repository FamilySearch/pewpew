import React from "react";

export const AddIcon = (props: React.SVGProps<SVGSVGElement>): JSX.Element => {
    return <svg
        width="15px"
        height="15px"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        {...props}
    >
        <path
            d="M12 4a1 1 0 0 1 1 1v6h6a1 1 0 1 1 0 2h-6v6a1 1 0 1 1-2 0v-6H5a1 1 0 1 1 0-2h6V5a1 1 0 0 1 1-1z"
            fill="white"
        />
    </svg>;
};
