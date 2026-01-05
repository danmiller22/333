export type StaffType = "Russians" | "Uzbeks" | "Americans" | "Mixed/Other";

export const STAFF_TYPES: StaffType[] = [
  "Russians",
  "Uzbeks",
  "Americans",
  "Mixed/Other",
];

export type Service =
  | "Tires"
  | "Oil"
  | "Engine"
  | "Transmission"
  | "Electrical"
  | "Body"
  | "Tow"
  | "Other";

export const SERVICES: Service[] = [
  "Tires",
  "Oil",
  "Engine",
  "Transmission",
  "Electrical",
  "Body",
  "Tow",
  "Other",
];

export type AddStep =
  | "shopName"
  | "address"
  | "city"
  | "state"
  | "phone"
  | "contactPerson"
  | "staffType"
  | "services"
  | "notes"
  | "confirm"
  | "editField";

export type FlowState =
  | {
      flow: "add";
      step: AddStep;
      data: Partial<ShopInput>;
      servicesSelected: Service[];
    }
  | {
      flow: "search";
      step: "awaitQuery";
      queryText?: string;
    };

export interface ShopInput {
  shopName: string;
  address: string;
  city: string;
  state: string; // 2-letter
  phone: string;
  contactPerson: string;
  staffType: StaffType;
  services: Service[];
  notes: string;
}

export interface ShopRow {
  createdAtISO: string;
  shopName: string;
  address: string;
  city: string;
  state: string;
  phone: string;
  contactPerson: string;
  staffType: StaffType | string;
  servicesCSV: string;
  notes: string;
  lat: number | null;
  lng: number | null;
}

export interface SearchResult {
  shop: ShopRow;
  distanceMiles: number;
}

export interface GeocodeResult {
  lat: number;
  lng: number;
  displayName?: string;
}
