window.NETLIFY_ENV = {};
const PAGE_SIZE = 30;

function getSecret(key, promptText, defaultValue) {
  let value =
    localStorage.getItem(key) || NETLIFY_ENV[key] || prompt(promptText, defaultValue);
  if (value) localStorage.setItem(key, value);
  return value;
}

const appId = getSecret('appId', 'Enter your strava client id');
const appSecret = getSecret('appSecret', 'Enter your strava client secret');
const mapKey = getSecret('mapKey', 'Enter your google maps api key');

const activityType = getSecret(
  'activityType',
  'Enter activity type (one of Ride, Run, Walk etc or All)',
  'All'
);

// prettier-ignore
async function loadMapLibrary() {
  (g=>{var h,a,k,p="The Google Maps JavaScript API",c="google",l="importLibrary",q="__ib__",m=document,b=window;b=b[c]||(b[c]={});var d=b.maps||(b.maps={}),r=new Set,e=new URLSearchParams,u=()=>h||(h=new Promise(async(f,n)=>{await (a=m.createElement("script"));e.set("libraries",[...r]+"");for(k in g)e.set(k.replace(/[A-Z]/g,t=>"_"+t[0].toLowerCase()),g[k]);e.set("callback",c+".maps."+q);a.src=`https://maps.${c}apis.com/maps/api/js?`+e;d[q]=f;a.onerror=()=>h=n(Error(p+" could not load."));a.nonce=m.querySelector("script[nonce]")?.nonce||"";m.head.append(a)}));d[l]?console.warn(p+" only loads once. Ignoring:",g):d[l]=(f,...n)=>r.add(f)&&u().then(()=>d[l](f,...n))})({
    key: mapKey,
    v: "weekly",
  });
  await google.maps.importLibrary('maps');
  await google.maps.importLibrary('geometry');
}

function loadMap(center) {
  const map = new google.maps.Map(document.getElementById('map'), {
    zoom: 10,
    center,
    mapTypeId: 'hybrid',
  });

  return map;
}

function unescapeJsonString(str) {
  return JSON.parse(`{"value": "${str}"}`).value;
}

async function callStravaApi(path, { method = 'GET', params }) {
  const urlParams = new URLSearchParams(params);
  const queryParams = method === 'GET' ? '?' + urlParams.toString() : '';

  return (
    await fetch(`https://www.strava.com/api/v3/${path}${queryParams}`, {
      method,
      body: method === 'POST' ? urlParams : undefined,
    })
  ).json();
}

let messageElem;

async function main() {
  const authCode = new URLSearchParams(location.search).get('code');

  let refreshToken = localStorage.getItem('refreshToken');
  if (!authCode && !refreshToken) {
    location.href = `https://www.strava.com/oauth/authorize?client_id=${appId}&response_type=code&redirect_uri=${location.href}&approval_prompt=auto&scope=activity:read_all`;
    return;
  }

  if (!refreshToken) {
    const refreshToken = (
      await callStravaApi('oauth/token', {
        method: 'POST',
        params: {
          client_id: appId,
          client_secret: appSecret,
          grant_type: 'authorization_code',
          code: authCode,
        },
      })
    ).refresh_token;
    if (!refreshToken) {
      alert('Login failed!');
      return;
    }
    localStorage.setItem('refreshToken', refreshToken);
  }

  const accessToken = (
    await callStravaApi('oauth/token', {
      method: 'POST',
      params: {
        client_id: appId,
        client_secret: appSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      },
    })
  ).access_token;

  let allActivities = [];
  messageElem.innerHTML += ' done<br /> Getting list of activities...';
  let page = Number(localStorage.getItem('lastPage')) || 1;
  while (true) {
    const newActivities = await callStravaApi('athlete/activities', {
      params: {
        access_token: accessToken,
        page,
        per_page: PAGE_SIZE,
      },
    });
    allActivities = allActivities.concat(newActivities);
    if (!newActivities.length || newActivities.length < PAGE_SIZE) {
      if (newActivities.length) {
        localStorage.setItem('lastPage', page);
      }
      break;
    }
    page++;
  }

  const activities = allActivities.filter(
    a => a.type === activityType || activityType === 'All'
  );

  messageElem.innerHTML += ` got ${activities.length} new activities<br />Getting maps for activities...`;

  for (const activity of activities) {
    const id = activity.id;
    let polyline = localStorage.getItem(`polyline-${id}`);
    if (!polyline) {
      const detailedActivity = await callStravaApi(`activities/${id}`, {
        params: {
          access_token: accessToken,
        },
      });
      polyline = detailedActivity.map.polyline;
      localStorage.setItem(`polyline-${id}`, polyline);
    }
  }

  await loadMapLibrary();
  let map;

  Object.keys(localStorage)
    .filter(k => k.startsWith('polyline-'))
    .forEach(k => {
      const polyline = localStorage.getItem(k);

      const coords = google.maps.geometry.encoding.decodePath(polyline);

      if (!map) {
        map = loadMap(coords[0]);
      }

      new google.maps.Polyline({
        path: coords,
        geodesic: true,
        strokeColor: '#FF0000',
        strokeOpacity: 0.5,
        strokeWeight: 1,
      }).setMap(map);
    });
}

document.addEventListener('DOMContentLoaded', () => {
  messageElem = document.getElementById('message');
  main().catch(e => {
    messageElem.innerHTML += `<br />Something went wrong ☹️`;
    console.error(e);
  });
});
