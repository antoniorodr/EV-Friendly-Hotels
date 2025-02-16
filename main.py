import geopandas as gpd 


gdf = gpd.read_file("EV-friendly hotels in Europe.kml", driver='libkml')
print(gdf.head())