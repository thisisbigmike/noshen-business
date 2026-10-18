// The three photos a seller is asked for when listing, by category: what a buyer will want to check, in the order
// they're taken. The first is the cover. Sellers can add up to five more of anything.
import { msg } from "./i18n";
import { categoryOf, type CategoryKey } from "./categories";

export interface Shot { title: string; hint: string }

/** How many photos a listing needs, and how many it can have. */
export const MIN_PHOTOS = 3;
export const MAX_PHOTOS = 8;

const SHOTS: Record<CategoryKey, [Shot, Shot, Shot]> = {
  phone: [
    { title: msg("The front, screen on"), hint: msg("Switched on, so buyers see the screen has no cracks.") },
    { title: msg("The back and sides"), hint: msg("Show any scratches or dents.") },
    { title: msg("The IMEI on the screen"), hint: msg("Dial *#06# and take a photo of what it shows.") },
  ],
  laptop: [
    { title: msg("Open, screen on"), hint: msg("Switched on, so buyers see it works.") },
    { title: msg("The keyboard"), hint: msg("Show the keys and the trackpad.") },
    { title: msg("Underneath"), hint: msg("Show the sticker with the serial number.") },
  ],
  electronics: [
    { title: msg("The front, switched on"), hint: msg("So buyers see it works.") },
    { title: msg("The back"), hint: msg("Show the ports and the label with the model.") },
    { title: msg("What comes with it"), hint: msg("The remote, cables or box, laid out together.") },
  ],
  fashion: [
    { title: msg("The whole item"), hint: msg("Laid flat or worn, in daylight.") },
    { title: msg("The size label"), hint: msg("Close enough to read it.") },
    { title: msg("The fabric, close up"), hint: msg("And any marks or stains.") },
  ],
  shoes: [
    { title: msg("Both shoes, from the side"), hint: msg("Side by side, in daylight.") },
    { title: msg("The soles"), hint: msg("So buyers see how worn they are.") },
    { title: msg("The size inside"), hint: msg("Close enough to read it.") },
  ],
  hair: [
    { title: msg("The whole wig, laid out"), hint: msg("On a plain cloth, in daylight.") },
    { title: msg("The lace or closure, close up"), hint: msg("Show the knots and the hairline.") },
    { title: msg("The length, with a tape measure"), hint: msg("From the top to the ends.") },
  ],
  beauty: [
    { title: msg("The front of the pack"), hint: msg("The brand and the name should be easy to read.") },
    { title: msg("The seal"), hint: msg("Sealed items sell faster.") },
    { title: msg("The batch code and expiry date"), hint: msg("Usually on the bottom or the back.") },
  ],
  jewellery: [
    { title: msg("The whole piece"), hint: msg("On a plain background.") },
    { title: msg("The stone or clasp, close up"), hint: msg("Show how it's made and any wear.") },
    { title: msg("Any stamp or brand mark"), hint: msg("Like 18K or 925, usually inside or on the clasp.") },
  ],
  home: [
    { title: msg("The whole item"), hint: msg("Where buyers can see its size.") },
    { title: msg("Close up of any marks"), hint: msg("Scratches, tears or stains.") },
    { title: msg("Switched on, or the label"), hint: msg("For an appliance, show it working. For furniture, any label.") },
  ],
  vehicle: [
    { title: msg("The front, from a corner"), hint: msg("So buyers see the front and one side.") },
    { title: msg("Inside"), hint: msg("The seats and the dashboard, with the mileage showing.") },
    { title: msg("The chassis number"), hint: msg("Under the windscreen or on the papers. Cover your personal details.") },
  ],
  baby: [
    { title: msg("The whole item"), hint: msg("Set up, the way it's used.") },
    { title: msg("Straps, wheels or buckles"), hint: msg("Close up, so buyers see they're safe.") },
    { title: msg("The label"), hint: msg("With the brand, the model or the size.") },
  ],
  sports: [
    { title: msg("The whole item"), hint: msg("In daylight, from the side.") },
    { title: msg("Moving parts or the display"), hint: msg("Switched on, if it has a screen.") },
    { title: msg("Any wear"), hint: msg("Grips, straps or marks.") },
  ],
  services: [
    { title: msg("A job you've finished"), hint: msg("Your best recent work.") },
    { title: msg("Another job"), hint: msg("Before and after works well.") },
    { title: msg("You at work, or your tools"), hint: msg("So buyers know who's coming.") },
  ],
  other: [
    { title: msg("The whole item"), hint: msg("In daylight, on a plain background.") },
    { title: msg("Close up of the details"), hint: msg("The brand, the model or anything special.") },
    { title: msg("Any marks or damage"), hint: msg("Honest photos mean fewer problems later.") },
  ],
};

/** The three photos to ask for, for a category. */
export const photoShots = (k: string | null | undefined): [Shot, Shot, Shot] => SHOTS[categoryOf(k).key];
