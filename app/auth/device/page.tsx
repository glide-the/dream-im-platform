// [Input] User code carried across Admin login or entered by the user.
// [Output] Device authorization interaction using existing provider state machine.
// [Pos] Public device verification page; no device code or tokens displayed.
import AuthDevice from "./AuthDevice";
export default function DevicePage() { return <AuthDevice />; }
