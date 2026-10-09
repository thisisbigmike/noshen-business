/** Photos are served by the Worker from R2 at /photos/<key>, cached for a year. */
export const photoUrl = (key: string) => `/photos/${key}`;
