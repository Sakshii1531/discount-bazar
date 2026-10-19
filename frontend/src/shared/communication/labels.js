import { CHANNELS } from "./communicationApi";

/** Who the user is talking to, phrased for each role × channel. */
export function channelLabels(role, channel) {
  if (role === "delivery") {
    return channel === CHANNELS.SELLER_RIDER
      ? { heading: "Store", chatTitle: "Chat with store", callLabel: "Call store" }
      : { heading: "Customer", chatTitle: "Chat with customer", callLabel: "Call customer" };
  }
  if (role === "seller") {
    return { heading: "Assigned rider", chatTitle: "Chat with rider", callLabel: "Call rider" };
  }
  return {
    heading: "Your delivery partner",
    chatTitle: "Chat with delivery partner",
    callLabel: "Call delivery partner",
  };
}

/** Human explanation for a channel that is not (fully) open. */
export function unavailableMessage({ role, channelState, assignment }) {
  if (!channelState) return "Contact options are not available for this order.";
  if (channelState.reason === "RIDER_NOT_ASSIGNED") {
    if (role === "seller") return "A rider has not been assigned to collect this order yet.";
    if (assignment?.delayed) {
      return "Finding a delivery partner is taking longer than usual. You can report an issue if you need help.";
    }
    return "Finding a delivery partner… You can contact them here once one is assigned.";
  }
  if (channelState.readOnly) return "This conversation has ended. Earlier messages are read-only.";
  if (channelState.reason === "CHAT_DISABLED") return "In-app chat is currently unavailable.";
  if (channelState.reason === "STATUS_NOT_ELIGIBLE") {
    return "Messaging is not available at this stage of the order.";
  }
  return "Contact options are not available for this order.";
}

export const CALL_DISCLOSURE_FALLBACK =
  "This opens your phone's dialer for a normal call through your mobile network. Your phone number will be visible to the person you call. The app does not mask numbers, record calls, or track whether a call was answered.";
