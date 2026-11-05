// Each category carries its own behavior, so a work schedule never asks for RSVPs.
export const CATEGORIES = {
  general:     { label: "Event",           color: "#6b7280", rsvp: true,  replies: true,  rec: "none",   range: false, icon: "📅" },
  work:        { label: "Work shift",      color: "#3b6fb6", rsvp: false, replies: false, rec: "none",   range: false, icon: "💼" },
  school:      { label: "School / college",color: "#7a5cc0", rsvp: false, replies: false, rec: "none",   range: true,  icon: "🎓" },
  away:        { label: "Out of town",     color: "#c07a1f", rsvp: false, replies: false, rec: "none",   range: true,  icon: "✈️" },
  holiday:     { label: "Holiday / tradition", color: "#b24a4a", rsvp: true, replies: true, rec: "yearly", range: false, icon: "🎄" },
  chore:       { label: "Chore / rotation",color: "#3b9aa3", rsvp: false, replies: false, rec: "weekly", range: false, icon: "🧹" },
  appointment: { label: "Appointment",     color: "#5b6b7a", rsvp: false, replies: false, rec: "none",   range: false, icon: "🩺" },
  birthday:    { label: "Birthday / anniversary", color: "#c0508a", rsvp: false, replies: true, rec: "yearly", range: false, icon: "🎂" },
  meal:        { label: "Meal",            color: "#6a9a3b", rsvp: true,  replies: true,  rec: "none",   range: false, icon: "🍽️" },
  trip:        { label: "Family trip",     color: "#2f6f5e", rsvp: true,  replies: true,  rec: "none",   range: true,  icon: "🧳" },
  movie:       { label: "Movie",           color: "#a21caf", rsvp: true,  replies: true,  rec: "none",   range: false, icon: "🎬" },
};
export const catOf = (k) => CATEGORIES[k] || CATEGORIES.general;
