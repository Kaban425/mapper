import "../../lib/styles/base.css";
import { mount } from "svelte";
import MainApp from "./MainApp.svelte";

const target = document.getElementById("app");
if (!target) throw new Error("#app is missing in main.html");

export default mount(MainApp, { target });
