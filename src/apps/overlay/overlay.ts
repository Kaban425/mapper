import "../../lib/styles/base.css";
import { mount } from "svelte";
import OverlayApp from "./OverlayApp.svelte";

const target = document.getElementById("app");
if (!target) throw new Error("#app is missing in overlay.html");

export default mount(OverlayApp, { target });
