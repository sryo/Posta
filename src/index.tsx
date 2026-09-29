/* @refresh reload */
import { render } from "solid-js/web";
import App from "./App";
import { preventFileDropNavigation } from "./app/fileDrop";

preventFileDropNavigation(window);

render(() => <App />, document.getElementById("root") as HTMLElement);
