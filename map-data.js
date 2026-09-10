/**
 * ParcelMap Cadastral Mapping Dataset
 * Authentic survey plots, infrastructure layers, and location hierarchies.
 */

export const LOCATION_HIERARCHY = {
  states: [
    {
      id: "MH",
      name: "Maharashtra",
      districts: [
        {
          id: "PUN",
          name: "Pune",
          talukas: [
            {
              id: "HAV",
              name: "Haveli",
              villages: [
                { id: "WAG", name: "Wagholi (Sheet #14)", center: [18.5793, 73.9825], zoom: 16 },
                { id: "LOH", name: "Lohegaon (Sheet #08)", center: [18.5912, 73.9284], zoom: 16 },
                { id: "KHA", name: "Kharadi (Sheet #22)", center: [18.5529, 73.9482], zoom: 16 }
              ]
            },
            {
              id: "MUL",
              name: "Mulshi",
              villages: [
                { id: "HIN", name: "Hinjawadi Phase-3", center: [18.5910, 73.6980], zoom: 16 },
                { id: "PIR", name: "Pirangut Rural", center: [18.5110, 73.6780], zoom: 16 }
              ]
            }
          ]
        },
        {
          id: "THN",
          name: "Thane",
          talukas: [
            {
              id: "KLN",
              name: "Kalyan",
              villages: [
                { id: "DOM", name: "Dombivli East (Sheet #04)", center: [19.2183, 73.0867], zoom: 16 }
              ]
            }
          ]
        }
      ]
    },
    {
      id: "KA",
      name: "Karnataka",
      districts: [
        {
          id: "BLR",
          name: "Bengaluru Urban",
          talukas: [
            {
              id: "BLR_S",
              name: "Bengaluru South",
              villages: [
                { id: "ELC", name: "Electronic City Phase-1", center: [12.8452, 77.6602], zoom: 16 }
              ]
            }
          ]
        }
      ]
    },
    {
      id: "GJ",
      name: "Gujarat",
      districts: [
        {
          id: "AMD",
          name: "Ahmedabad",
          talukas: [
            {
              id: "DASK",
              name: "Daskroi",
              villages: [
                { id: "BOP", name: "Bopal Rural", center: [23.0338, 72.4645], zoom: 16 }
              ]
            }
          ]
        }
      ]
    }
  ]
};

// Base coordinates around Wagholi, Pune [18.5793, 73.9825]
// Lat step ~ 0.001 (approx 111m), Lng step ~ 0.001 (approx 105m)
export const CADASTRAL_PLOTS = [
  {
    id: "plot-101",
    plotNo: "101",
    surveyNo: "42/1",
    subDivision: "A",
    landType: "Agricultural",
    status: "Clear Title",
    owner: "Rameshwar Pandurang Patil",
    coOwners: ["Sunita R. Patil", "Anand R. Patil"],
    khataNo: "KH-8429",
    mutationNo: "ME-19402",
    areaAcre: 1.45,
    areaGuntha: 58.0,
    areaHectare: 0.587,
    areaSqM: 5868,
    roadAccess: "Highway Direct Touch (30m)",
    soilGrade: "Medium Black (Grade 1)",
    waterSource: "Canal + Borewell",
    govtRateSqM: 4200,
    builtUp: false,
    coordinates: [
      [18.5818, 73.9795],
      [18.5828, 73.9818],
      [18.5819, 73.9825],
      [18.5809, 73.9802]
    ]
  },
  {
    id: "plot-102",
    plotNo: "102",
    surveyNo: "42/2",
    subDivision: "B",
    landType: "Agricultural",
    status: "Clear Title",
    owner: "Balasaheb Tukaram Shinde",
    coOwners: ["Kavita B. Shinde"],
    khataNo: "KH-8430",
    mutationNo: "ME-19405",
    areaAcre: 1.20,
    areaGuntha: 48.0,
    areaHectare: 0.485,
    areaSqM: 4856,
    roadAccess: "Village Internal Road (12m)",
    soilGrade: "Deep Black Fertile",
    waterSource: "Perennial Well",
    govtRateSqM: 3800,
    builtUp: false,
    coordinates: [
      [18.5828, 73.9818],
      [18.5838, 73.9840],
      [18.5828, 73.9848],
      [18.5819, 73.9825]
    ]
  },
  {
    id: "plot-103",
    plotNo: "103",
    surveyNo: "43/1",
    subDivision: "-",
    landType: "Non-Agricultural (NA)",
    status: "Clear Title",
    owner: "Apex Infra Reality LLP",
    coOwners: ["Director: Vikram Mehta"],
    khataNo: "KH-9102",
    mutationNo: "ME-22110",
    areaAcre: 2.10,
    areaGuntha: 84.0,
    areaHectare: 0.850,
    areaSqM: 8498,
    roadAccess: "Dual Road Corner (30m & 18m)",
    soilGrade: "Murrum / Hard Strata",
    waterSource: "Municipal Supply Pipeline",
    govtRateSqM: 14500,
    builtUp: true,
    coordinates: [
      [18.5838, 73.9840],
      [18.5849, 73.9865],
      [18.5836, 73.9875],
      [18.5828, 73.9848]
    ]
  },
  {
    id: "plot-104A",
    plotNo: "104A",
    surveyNo: "43/2A",
    subDivision: "1",
    landType: "Commercial",
    status: "Clear Title",
    owner: "Sahyadri Logistics Park Corp",
    coOwners: ["Trustee Board"],
    khataNo: "KH-9340",
    mutationNo: "ME-23490",
    areaAcre: 3.40,
    areaGuntha: 136.0,
    areaHectare: 1.376,
    areaSqM: 13759,
    roadAccess: "State Highway 27 Frontage",
    soilGrade: "Constructible Basalt Strata",
    waterSource: "Dedicated Industrial Bore",
    govtRateSqM: 18200,
    builtUp: true,
    coordinates: [
      [18.5849, 73.9865],
      [18.5862, 73.9892],
      [18.5848, 73.9902],
      [18.5836, 73.9875]
    ]
  },
  {
    id: "plot-104B",
    plotNo: "104B",
    surveyNo: "43/2B",
    subDivision: "2",
    landType: "Commercial",
    status: "Mortgaged",
    owner: "Vardhman Warehousing Corp",
    coOwners: ["Bank of Maharashtra Hypothecation"],
    khataNo: "KH-9341",
    mutationNo: "ME-23495",
    areaAcre: 2.80,
    areaGuntha: 112.0,
    areaHectare: 1.133,
    areaSqM: 11331,
    roadAccess: "State Highway 27 Frontage",
    soilGrade: "Constructible Basalt Strata",
    waterSource: "Industrial Tanker & Well",
    govtRateSqM: 18200,
    builtUp: true,
    coordinates: [
      [18.5862, 73.9892],
      [18.5875, 73.9920],
      [18.5860, 73.9928],
      [18.5848, 73.9902]
    ]
  },
  {
    id: "plot-105",
    plotNo: "105",
    surveyNo: "44/1",
    subDivision: "-",
    landType: "Residential",
    status: "Clear Title",
    owner: "Green Meadows Co-op Housing",
    coOwners: ["Society Secretary: D. Deshmukh"],
    khataNo: "KH-9844",
    mutationNo: "ME-24018",
    areaAcre: 1.80,
    areaGuntha: 72.0,
    areaHectare: 0.728,
    areaSqM: 7284,
    roadAccess: "15m DP Road",
    soilGrade: "Hard Red Murrum",
    waterSource: "PMRDA Water Pipeline",
    govtRateSqM: 16000,
    builtUp: true,
    coordinates: [
      [18.5809, 73.9802],
      [18.5819, 73.9825],
      [18.5806, 73.9834],
      [18.5796, 73.9810]
    ]
  },
  {
    id: "plot-106",
    plotNo: "106",
    surveyNo: "44/2",
    subDivision: "A",
    landType: "Residential",
    status: "Clear Title",
    owner: "Sanjay Ganpatrao Kadam",
    coOwners: ["Meena S. Kadam"],
    khataNo: "KH-9850",
    mutationNo: "ME-24102",
    areaAcre: 0.95,
    areaGuntha: 38.0,
    areaHectare: 0.384,
    areaSqM: 3844,
    roadAccess: "12m Internal Road",
    soilGrade: "Firm Murrum",
    waterSource: "Borewell",
    govtRateSqM: 15500,
    builtUp: true,
    coordinates: [
      [18.5819, 73.9825],
      [18.5828, 73.9848],
      [18.5816, 73.9856],
      [18.5806, 73.9834]
    ]
  },
  {
    id: "plot-107",
    plotNo: "107",
    surveyNo: "45/1",
    subDivision: "-",
    landType: "Government",
    status: "Govt Leased",
    owner: "Zilla Parishad Maharashtra",
    coOwners: ["Education Dept (Primary School & Ground)"],
    khataNo: "KH-0012",
    mutationNo: "ME-08112",
    areaAcre: 2.50,
    areaGuntha: 100.0,
    areaHectare: 1.011,
    areaSqM: 10117,
    roadAccess: "18m Public Avenue",
    soilGrade: "Flat Sandy Clay",
    waterSource: "Municipal Tap & Storage Tank",
    govtRateSqM: 9500,
    builtUp: true,
    coordinates: [
      [18.5828, 73.9848],
      [18.5836, 73.9875],
      [18.5822, 73.9885],
      [18.5816, 73.9856]
    ]
  },
  {
    id: "plot-108",
    plotNo: "108",
    surveyNo: "45/2",
    subDivision: "B",
    landType: "Agricultural",
    status: "In Dispute",
    owner: "Mahadev Kisan Gaikwad (Heirs)",
    coOwners: ["Civil Suit #412/2023 Pending"],
    khataNo: "KH-8521",
    mutationNo: "ME-20109",
    areaAcre: 3.10,
    areaGuntha: 124.0,
    areaHectare: 1.254,
    areaSqM: 12545,
    roadAccess: "Cart Track (6m)",
    soilGrade: "Black Cotton Soil",
    waterSource: "Canal Feeder",
    govtRateSqM: 3500,
    builtUp: false,
    coordinates: [
      [18.5836, 73.9875],
      [18.5848, 73.9902],
      [18.5833, 73.9912],
      [18.5822, 73.9885]
    ]
  },
  {
    id: "plot-109",
    plotNo: "109",
    surveyNo: "46/1",
    subDivision: "-",
    landType: "Green / Forest",
    status: "Clear Title",
    owner: "Krishival Agro Hortitech",
    coOwners: ["Ashok V. Bhosale"],
    khataNo: "KH-8710",
    mutationNo: "ME-20890",
    areaAcre: 4.20,
    areaGuntha: 168.0,
    areaHectare: 1.700,
    areaSqM: 16997,
    roadAccess: "Paved Farm Road (9m)",
    soilGrade: "Rich Alluvial Loam",
    waterSource: "Drip Irrigation + Farm Pond",
    govtRateSqM: 4000,
    builtUp: false,
    coordinates: [
      [18.5848, 73.9902],
      [18.5860, 73.9928],
      [18.5845, 73.9939],
      [18.5833, 73.9912]
    ]
  },
  {
    id: "plot-110",
    plotNo: "110",
    surveyNo: "47/1",
    subDivision: "A",
    landType: "Agricultural",
    status: "Clear Title",
    owner: "Vasantrao Narhari Jagtap",
    coOwners: ["Pravin V. Jagtap"],
    khataNo: "KH-8805",
    mutationNo: "ME-21140",
    areaAcre: 2.35,
    areaGuntha: 94.0,
    areaHectare: 0.951,
    areaSqM: 9510,
    roadAccess: "Village Internal Road (12m)",
    soilGrade: "Medium Black Soil",
    waterSource: "Borewell",
    govtRateSqM: 4100,
    builtUp: false,
    coordinates: [
      [18.5796, 73.9810],
      [18.5806, 73.9834],
      [18.5792, 73.9842],
      [18.5782, 73.9818]
    ]
  },
  {
    id: "plot-111",
    plotNo: "111",
    surveyNo: "47/2",
    subDivision: "B",
    landType: "Industrial",
    status: "Clear Title",
    owner: "Precision Auto Components Pvt Ltd",
    coOwners: ["MIDC Sub-lease Allotment"],
    khataNo: "KH-9601",
    mutationNo: "ME-23910",
    areaAcre: 2.90,
    areaGuntha: 116.0,
    areaHectare: 1.173,
    areaSqM: 11736,
    roadAccess: "Industrial Feeder Road (24m)",
    soilGrade: "Levelled Hard Rock",
    waterSource: "MIDC Industrial Pipeline",
    govtRateSqM: 13500,
    builtUp: true,
    coordinates: [
      [18.5806, 73.9834],
      [18.5816, 73.9856],
      [18.5802, 73.9866],
      [18.5792, 73.9842]
    ]
  },
  {
    id: "plot-112",
    plotNo: "112",
    surveyNo: "48/1",
    subDivision: "-",
    landType: "Residential",
    status: "Clear Title",
    owner: "Suyash Residency Scheme",
    coOwners: ["Promoter: Anand Developers"],
    khataNo: "KH-9920",
    mutationNo: "ME-24512",
    areaAcre: 1.65,
    areaGuntha: 66.0,
    areaHectare: 0.668,
    areaSqM: 6677,
    roadAccess: "15m Town Planning Road",
    soilGrade: "Red Loam Murrum",
    waterSource: "Gram Panchayat Pipeline",
    govtRateSqM: 15200,
    builtUp: true,
    coordinates: [
      [18.5816, 73.9856],
      [18.5822, 73.9885],
      [18.5808, 73.9894],
      [18.5802, 73.9866]
    ]
  },
  {
    id: "plot-113",
    plotNo: "113",
    surveyNo: "48/2",
    subDivision: "A",
    landType: "Water Catchment",
    status: "Govt Leased",
    owner: "Irrigation Department (Canal Buffer)",
    coOwners: ["State of Maharashtra"],
    khataNo: "KH-0004",
    mutationNo: "ME-01980",
    areaAcre: 1.10,
    areaGuntha: 44.0,
    areaHectare: 0.445,
    areaSqM: 4452,
    roadAccess: "Service Bund Road (8m)",
    soilGrade: "Riparian Alluvium",
    waterSource: "Live Canal Edge",
    govtRateSqM: 2500,
    builtUp: false,
    coordinates: [
      [18.5822, 73.9885],
      [18.5833, 73.9912],
      [18.5819, 73.9922],
      [18.5808, 73.9894]
    ]
  },
  {
    id: "plot-114",
    plotNo: "114",
    surveyNo: "49/1",
    subDivision: "-",
    landType: "Religious",
    status: "Clear Title",
    owner: "Shree Siddheshwar Mandir Devsthan Trust",
    coOwners: ["Public Trust Reg: E-4912"],
    khataNo: "KH-0150",
    mutationNo: "ME-04500",
    areaAcre: 0.85,
    areaGuntha: 34.0,
    areaHectare: 0.344,
    areaSqM: 3439,
    roadAccess: "Temple Plaza Road (15m)",
    soilGrade: "Elevated Stone Strata",
    waterSource: "Trust Kund & Well",
    govtRateSqM: 8000,
    builtUp: true,
    coordinates: [
      [18.5833, 73.9912],
      [18.5845, 73.9939],
      [18.5831, 73.9949],
      [18.5819, 73.9922]
    ]
  },
  {
    id: "plot-115",
    plotNo: "115",
    surveyNo: "50/1",
    subDivision: "A",
    landType: "Agricultural",
    status: "Clear Title",
    owner: "Kisan Bapu Khedekar",
    coOwners: ["Dattatray K. Khedekar"],
    khataNo: "KH-8889",
    mutationNo: "ME-21440",
    areaAcre: 1.75,
    areaGuntha: 70.0,
    areaHectare: 0.708,
    areaSqM: 7082,
    roadAccess: "Village Internal Road (12m)",
    soilGrade: "Deep Black Fertile",
    waterSource: "Farm Well",
    govtRateSqM: 3900,
    builtUp: false,
    coordinates: [
      [18.5782, 73.9818],
      [18.5792, 73.9842],
      [18.5778, 73.9850],
      [18.5768, 73.9826]
    ]
  },
  {
    id: "plot-116",
    plotNo: "116",
    surveyNo: "50/2",
    subDivision: "B",
    landType: "Agricultural",
    status: "Clear Title",
    owner: "Nivruti Sakharam More",
    coOwners: ["Shobha N. More"],
    khataNo: "KH-8892",
    mutationNo: "ME-21455",
    areaAcre: 1.50,
    areaGuntha: 60.0,
    areaHectare: 0.607,
    areaSqM: 6070,
    roadAccess: "Field Track (6m)",
    soilGrade: "Black Cotton Soil",
    waterSource: "Canal Branch",
    govtRateSqM: 3800,
    builtUp: false,
    coordinates: [
      [18.5792, 73.9842],
      [18.5802, 73.9866],
      [18.5788, 73.9875],
      [18.5778, 73.9850]
    ]
  },
  {
    id: "plot-117",
    plotNo: "117",
    surveyNo: "51/1",
    subDivision: "-",
    landType: "Hospital",
    status: "Clear Title",
    owner: "Sanjivani Community Health Foundation",
    coOwners: ["Dr. S. R. Joshi (Managing Trustee)"],
    khataNo: "KH-9700",
    mutationNo: "ME-24120",
    areaAcre: 2.20,
    areaGuntha: 88.0,
    areaHectare: 0.890,
    areaSqM: 8903,
    roadAccess: "Main Zilla Parishad Highway (24m)",
    soilGrade: "Constructible Red Murrum",
    waterSource: "Dedicated 24/7 Municipal & Bore",
    govtRateSqM: 14200,
    builtUp: true,
    coordinates: [
      [18.5802, 73.9866],
      [18.5808, 73.9894],
      [18.5795, 73.9904],
      [18.5788, 73.9875]
    ]
  },
  {
    id: "plot-118",
    plotNo: "118",
    surveyNo: "51/2",
    subDivision: "A",
    landType: "Parking / Logistics",
    status: "Clear Title",
    owner: "PMRDA Municipal Multi-level Logistics",
    coOwners: ["Public Infrastructure Zone"],
    khataNo: "KH-0055",
    mutationNo: "ME-09820",
    areaAcre: 1.30,
    areaGuntha: 52.0,
    areaHectare: 0.526,
    areaSqM: 5261,
    roadAccess: "24m Main Road + 15m Service Lane",
    soilGrade: "Asphalt & Paver Hardened",
    waterSource: "Storm Water Harvest Basin",
    govtRateSqM: 16500,
    builtUp: true,
    coordinates: [
      [18.5808, 73.9894],
      [18.5819, 73.9922],
      [18.5805, 73.9932],
      [18.5795, 73.9904]
    ]
  },
  {
    id: "plot-119",
    plotNo: "119",
    surveyNo: "52/1",
    subDivision: "-",
    landType: "Electricity Substation",
    status: "Govt Leased",
    owner: "MSEDCL 220kV Switching Yard",
    coOwners: ["Maharashtra State Power Transmission Co."],
    khataNo: "KH-0008",
    mutationNo: "ME-03410",
    areaAcre: 3.80,
    areaGuntha: 152.0,
    areaHectare: 1.538,
    areaSqM: 15378,
    roadAccess: "Security Fenced Heavy Load Road",
    soilGrade: "Crushed Gravel High Resistance",
    waterSource: "Industrial Supply",
    govtRateSqM: 11000,
    builtUp: true,
    coordinates: [
      [18.5819, 73.9922],
      [18.5831, 73.9949],
      [18.5817, 73.9960],
      [18.5805, 73.9932]
    ]
  },
  {
    id: "plot-120",
    plotNo: "120",
    surveyNo: "53/1",
    subDivision: "A",
    landType: "Railway Corridor",
    status: "Govt Leased",
    owner: "Central Railway (Pune-Daund Quadrupling)",
    coOwners: ["Ministry of Railways, Govt of India"],
    khataNo: "KH-0001",
    mutationNo: "ME-00100",
    areaAcre: 5.50,
    areaGuntha: 220.0,
    areaHectare: 2.225,
    areaSqM: 22257,
    roadAccess: "Railway Service Access Road",
    soilGrade: "Ballast Embankment",
    waterSource: "Culvert Drainage",
    govtRateSqM: 7500,
    builtUp: true,
    coordinates: [
      [18.5831, 73.9949],
      [18.5843, 73.9976],
      [18.5828, 73.9987],
      [18.5817, 73.9960]
    ]
  }
];

// Linear & Polygon Infrastructure layers
export const MAP_INFRASTRUCTURE = {
  roads: [
    {
      id: "road-main-hwy",
      name: "Pune-Ahmednagar State Highway SH-27",
      type: "Highway",
      lanes: 4,
      widthM: 30,
      coordinates: [
        [18.5878, 73.9780],
        [18.5862, 73.9840],
        [18.5849, 73.9892],
        [18.5835, 73.9950],
        [18.5822, 74.0000]
      ]
    },
    {
      id: "road-village-spine",
      name: "Wagholi Central Cadastral Avenue",
      type: "Arterial",
      lanes: 2,
      widthM: 18,
      coordinates: [
        [18.5818, 73.9795],
        [18.5828, 73.9848],
        [18.5836, 73.9875],
        [18.5845, 73.9939]
      ]
    },
    {
      id: "road-south-connect",
      name: "Gram Panchayat Ring Link Road",
      type: "Village",
      lanes: 2,
      widthM: 12,
      coordinates: [
        [18.5768, 73.9826],
        [18.5778, 73.9850],
        [18.5788, 73.9875],
        [18.5795, 73.9904],
        [18.5805, 73.9932]
      ]
    }
  ],

  railway: [
    {
      id: "rail-central",
      name: "Pune-Daund Central Railway Main Line",
      type: "Broad Gauge Double Track",
      coordinates: [
        [18.5855, 73.9940],
        [18.5840, 73.9965],
        [18.5825, 73.9985],
        [18.5805, 74.0010]
      ]
    }
  ],

  electricity: [
    {
      id: "ht-line-220kv",
      name: "220kV Lonikand-Wagholi High Tension Transmission Line",
      type: "220kV HT Line",
      coordinates: [
        [18.5880, 73.9890],
        [18.5845, 73.9915],
        [18.5810, 73.9940],
        [18.5775, 73.9965]
      ]
    }
  ],

  waterBodies: [
    {
      id: "water-canal",
      name: "Khadakwasla Left Bank Branch Canal",
      type: "Canal",
      coordinates: [
        [18.5830, 73.9870],
        [18.5822, 73.9885],
        [18.5815, 73.9905],
        [18.5808, 73.9925],
        [18.5798, 73.9945]
      ]
    },
    {
      id: "water-lake",
      name: "Wagholi Gaothan Water Catchment Lake",
      type: "Lake / Waterbody",
      polygon: [
        [18.5755, 73.9880],
        [18.5765, 73.9905],
        [18.5758, 73.9920],
        [18.5746, 73.9905],
        [18.5748, 73.9885]
      ]
    }
  ],

  buildings: [
    {
      id: "bld-1",
      name: "Apex Logistics HQ Block A",
      type: "Commercial",
      polygon: [
        [18.5852, 73.9870],
        [18.5858, 73.9882],
        [18.5854, 73.9886],
        [18.5848, 73.9874]
      ]
    },
    {
      id: "bld-2",
      name: "Green Meadows Residential Tower 1",
      type: "Residential",
      polygon: [
        [18.5804, 73.9812],
        [18.5810, 73.9822],
        [18.5806, 73.9825],
        [18.5800, 73.9815]
      ]
    },
    {
      id: "bld-3",
      name: "Sanjivani Hospital Main Wing",
      type: "Healthcare",
      polygon: [
        [18.5800, 73.9872],
        [18.5805, 73.9884],
        [18.5799, 73.9888],
        [18.5794, 73.9876]
      ]
    },
    {
      id: "bld-4",
      name: "Precision Auto Components Manufacturing Shed",
      type: "Industrial",
      polygon: [
        [18.5800, 73.9840],
        [18.5808, 73.9852],
        [18.5802, 73.9857],
        [18.5795, 73.9844]
      ]
    }
  ]
};

// Points of Interest (Schools, Hospitals, Temples, Government, Parking, Landmarks)
export const MAP_POIS = [
  {
    id: "poi-school-1",
    name: "Zilla Parishad Senior Secondary School",
    category: "school",
    icon: "🏫",
    lat: 18.5826,
    lng: 73.9868,
    details: "Affiliated State Board • 850 Students • Cadastral Survey #45/1"
  },
  {
    id: "poi-hospital-1",
    name: "Sanjivani Multispeciality Emergency Care",
    category: "hospital",
    icon: "🏥",
    lat: 18.5798,
    lng: 73.9885,
    details: "120 Beds • 24/7 Trauma • PMJAY Empanelled"
  },
  {
    id: "poi-temple-1",
    name: "Historical Shree Siddheshwar Mandir",
    category: "religious",
    icon: "🛕",
    lat: 18.5838,
    lng: 73.9925,
    details: "300-yr Heritage Stone Temple & Devsthan Trust Grounds"
  },
  {
    id: "poi-govt-1",
    name: "Taluka Land Revenue Office & Gram Panchayat",
    category: "government",
    icon: "🏛️",
    lat: 18.5830,
    lng: 73.9855,
    details: "Talathi Office • Mutation Deeds & 7/12 Cadastral Cell"
  },
  {
    id: "poi-parking-1",
    name: "PMRDA Public Freight & Car Parking Hub",
    category: "parking",
    icon: "🅿️",
    lat: 18.5802,
    lng: 73.9915,
    details: "Capacity: 350 Heavy Commercial & 600 Passenger Vehicles"
  },
  {
    id: "poi-landmark-1",
    name: "Apex IT Towers Landmark",
    category: "poi",
    icon: "📍",
    lat: 18.5855,
    lng: 73.9880,
    details: "Major Spatial Anchor at SH-27 Intersection"
  }
];
