type LocationReplacement = Readonly<{
  replace(path: string): void
}>

export function navigateToAuthenticatedPortal(
  path: string,
  location: LocationReplacement = window.location,
): void {
  location.replace(path)
}
