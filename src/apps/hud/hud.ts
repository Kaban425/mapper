import "../../lib/styles/base.css";
import { mount } from "svelte";
import HudApp from "./HudApp.svelte";

const target = document.getElementById("app");
if (!target) throw new Error("#app is missing in hud.html");

export default mount(HudApp, { target });
